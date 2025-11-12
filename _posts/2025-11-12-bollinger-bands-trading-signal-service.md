---
layout: post
title: "Yahoo Finance says 2,000 requests/hour but I measured 48 requests/day"
date: 2025-11-12 14:00:00 +0000
categories: [trading, system-design, python]
tags: [bollinger-bands, algorithmic-trading, rate-limiting, api-design, complexity-tradeoffs, incremental-updates, sqlite]
---

I built a hobby trading signal service that downloads hourly stock data from Yahoo Finance. The documentation says I can make 2,000 requests per hour. I got throttled after 5 requests.

This is the story of how I spent two days systematically mapping Yahoo Finance's _actual_ rate limits through empirical testing, and how those constraints forced me to add 300 lines of incremental update logic I really didn't want to write. The Bollinger Bands trading strategy itself is textbook material - this post is about discovering API constraints that aren't documented anywhere and deciding when complexity is worth the tradeoff.

## Mapping the real rate limits

Here's what I started with: I wanted to download 60 days of hourly candlestick data for 5 tickers (SPY, QQQ, AAPL, MSFT, GOOGL), run a Bollinger Bands calculation, and send myself alerts when the price touched the bands. Simple enough. The `yfinance` Python library makes this trivial:

```python
import yfinance as yf
df = yf.download("SPY", period="60d", interval="1h")
```

I figured with a documented limit of 2,000 requests/hour, I could easily poll every 8 hours without issues. 5 tickers × 3 runs/day = 15 requests/day. Plenty of headroom, right?

Wrong. After the third ticker on my first test run, I got a 429 error. Then another. Then Yahoo Finance stopped responding entirely for my IP address.

I spent the next two days systematically testing different request patterns to figure out what was _actually_ happening:

| Request Pattern | Period | Interval | Success Rate | Time to Throttle |
|----------------|---------|----------|--------------|------------------|
| Full download | 60d | 1h | 3-5 requests | ~2 minutes |
| Full download | 30d | 1h | 8-12 requests | ~5 minutes |
| Date range (1d) | start/end | 1h | 45+ requests | Never throttled |
| Date range (7d) | start/end | 1h | 15-20 requests | ~10 minutes |

The pattern became clear after about 200 test requests: Yahoo Finance doesn't care about request _count_. It cares about data _volume_. When you use `period="60d"`, you're pulling 1,440 hourly candles in one shot. That triggers aggressive throttling after just a handful of requests. But if you ask for a single day using `start` and `end` parameters? I could make 45+ requests before seeing any pushback.

This makes sense from a server load perspective - they want to discourage bulk historical data scraping - but it's _completely undocumented_. The official "2,000 requests/hour" limit is technically true but practically useless information.

I had two options: pay for a proper financial data API (Alpha Vantage, Polygon.io, etc.) or work within Yahoo Finance's weird constraints. This is a $0 hobby project, so I needed to make the free option work.

## The incremental update problem

Here's what I wanted to build:

```python
# Simple approach - download everything fresh each time
def run_strategy(ticker):
    df = yf.download(ticker, period="60d", interval="1h")  # 1,440 candles
    calculate_bollinger_bands(df)
    detect_signals(df)
    send_alerts()
```

This is beautiful. Completely stateless. No database. No complex logic. Every run starts fresh, processes the data, sends alerts if needed, and exits. Dead simple.

But it doesn't work. With 5 tickers and 3 runs per day, I hit the throttling limit within hours of deployment.

So I had to implement incremental updates. Instead of downloading 60 days every time, I'd store the data in a database and only fetch new candles since the last run. Here's what that looks like:

```python
# Incremental approach - only fetch what's new
def run_strategy(ticker):
    latest = db.get_latest_datetime(ticker)

    if latest:
        # We have historical data, just get the new stuff
        df = yf.download(ticker, start=latest, end=now)
        new_data = df[df["Datetime"] > latest]
        db.insert_candles(ticker, new_data)
    else:
        # First run, need to bootstrap
        df = yf.download(ticker, period="60d")
        db.insert_candles(ticker, df)

    df = db.get_candles(ticker)
    calculate_bollinger_bands(df)
    detect_signals(df)
    send_alerts()
```

This works. On the first run, I download 60 days of data. Every subsequent run only fetches 3-8 new hourly candles. That's a 99.5% reduction in data volume, which keeps me comfortably under Yahoo Finance's mysterious rate limits.

But look at what I had to add:
- A database (I chose SQLite)
- State management for tracking the latest timestamp per ticker
- Two completely different code paths (initial bootstrap vs incremental)
- Edge case handling (timezones, duplicates, data gaps)
- New failure modes (corrupted database, missing data, clock skew)

This added 300 lines of code - 22% of the entire codebase - just to work around rate limiting. I really didn't want this complexity. But without it, the service is unusable.

## Minimizing the damage

I couldn't avoid the complexity, but I could try to contain it. Here are the decisions I made to keep this from spiraling into a distributed systems nightmare.

### SQLite not PostgreSQL

I briefly considered PostgreSQL because "proper" time-series data belongs in a "real" database. Then I remembered this is a hobby project monitoring 5 stock tickers, not a production system handling millions of time series.

SQLite is a single 660KB file. No server process. No connection pools. No network latency. Just:

```python
db = StockDatabase("/app/data/stock_data.db")
```

For comparison, PostgreSQL would require:
- Running a separate Docker container
- Connection pooling configuration
- Schema migrations with Alembic
- Backup and restore strategy
- Network error handling and retries
- More complex testing setup

None of that complexity is justified for a database that will eventually hold maybe 5MB of candlestick data.

### Using the database to prevent duplicates

When you're fetching incremental updates, you'll inevitably pull overlapping data. The last candle from the previous run might get downloaded again. I could handle this in Python - check if a record exists before inserting - but that's racy and error-prone.

Instead, I made the database enforce uniqueness:

```sql
CREATE TABLE candles (
    ticker TEXT NOT NULL,
    datetime TIMESTAMP NOT NULL,
    open REAL, high REAL, low REAL, close REAL, volume REAL,
    PRIMARY KEY (ticker, datetime)
);
```

Now I can do:

```python
INSERT OR IGNORE INTO candles (ticker, datetime, ...)
```

Duplicate rows get silently ignored at the database level. No SELECT-before-INSERT. No race conditions. No application logic for deduplication. The constraint lives in the schema where it belongs.

### Keeping the strategy calculation pure

Even though I needed state for data storage, I kept the actual Bollinger Bands calculation completely stateless:

```python
def apply_bollinger_bands_and_signals(df: pd.DataFrame) -> None:
    """DataFrame in, mutated DataFrame out. No side effects."""
    df["SMA"] = df["Close"].rolling(window=80).mean()
    df["STD"] = df["Close"].rolling(window=80).std()
    df["Upper"] = df["SMA"] + 2 * df["STD"]
    df["Lower"] = df["SMA"] - 2 * df["STD"]
    # State machine logic for signal detection
```

This function doesn't touch the database, doesn't make API calls, doesn't read config files. It just does math on a DataFrame. This makes it trivial to test (no mocks needed), easy to reuse (my Streamlit UI calls the same code), and completely deterministic.

### In-memory rate limiting

I needed to enforce my discovered 48-requests-per-24-hours limit. I could have stored request timestamps in the database, but I went with a simpler in-memory approach:

```python
class RateLimiter:
    def __init__(self, max_requests=48, window_hours=24):
        self.requests = deque()  # Just timestamps

    def wait_if_needed(self):
        cutoff = datetime.now() - timedelta(hours=24)
        # Drop timestamps older than 24 hours
        while self.requests and self.requests[0] < cutoff:
            self.requests.popleft()

        if len(self.requests) >= self.max_requests:
            # Calculate how long to sleep
            wait_time = (self.requests[0] - cutoff).total_seconds()
            time.sleep(wait_time + 1)
```

The tradeoff: if the service restarts, it forgets about previous requests and might be more aggressive than needed. That's fine. I'd rather have occasional rate limit breaches after restarts than add another 100 lines of code to persist rate limiter state.

## What I learned

### Documentation lies (or at least misleads)

The [yfinance library documentation](https://github.com/ranaroussi/yfinance) mentions Yahoo Finance's rate limiting in passing, and various Stack Overflow threads reference a 2,000 requests/hour limit. That's technically true, but it's measuring the wrong thing. The real constraint is data volume per unit time, not request count. A request for 60 days of hourly data isn't the same as a request for 1 day of hourly data, even though both count as "1 request" according to that metric.

The only way to discover this was through systematic testing. I wrote a test harness that tried different request patterns and logged when throttling kicked in:

```python
# test_rate_limits.py
for period in ["7d", "30d", "60d"]:
    for i in range(50):
        try:
            df = yf.download("SPY", period=period)
            log_success(period, i)
        except Exception as e:
            log_failure(period, i, e)
            break
```

I ran variations of this for two days, building up a table of when throttling occurred. That's the only reason I know the actual limits.

### Sometimes complexity is unavoidable

I spent maybe 15 minutes building the simple stateless version. It was beautiful. It got throttled after 2 hours in production.

The incremental update version took 4 hours to build and added 300 lines of database and state management code. It has failure modes the simple version doesn't have. It's harder to test. It's harder to reason about.

But it works. It's been running for weeks without hitting rate limits.

I don't love this code. I didn't _want_ to write it. But given the constraints - free API, 60 days of data required, continuous monitoring needed - it was the right choice.

### Test the risky parts, skip the obvious parts

My overall test coverage is 16%. But coverage for `data_fetcher.py` - the module handling incremental updates - is 83%. This is intentional.

I wrote tests for the state transitions:
```python
def test_fetch_incremental_when_existing_data():
    """Does it actually skip downloading full history?"""

def test_no_fetch_when_data_is_recent():
    """Does it avoid pointless API calls?"""
```

I didn't write tests for the Bollinger Bands calculation. It's `df.rolling(window=80).mean()`. If pandas is broken, I have bigger problems. The complexity and risk is in the incremental update logic, so that's where the tests live.

### Docker doesn't make things simpler, just more reproducible

I packaged everything with Docker and `uv` for dependency management:

```dockerfile
FROM python:3.11-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/
RUN uv sync --frozen --no-dev
CMD ["sh", "-c", "uv run streamlit run app.py & uv run python -m service"]
```

This is great for deployment. But Docker doesn't reduce complexity. I still have two processes sharing a database, log output going to multiple streams, environment variables to configure, and all the same failure modes. Docker just makes it _reproducible_ complexity instead of "works on my machine" complexity.

### I almost over-engineered this into oblivion

When I first scoped this project, I considered:
- Redis for distributed rate limiting state
- PostgreSQL with TimescaleDB for proper time-series storage
- Celery for task queuing
- Separate worker containers for horizontal scaling

Then I remembered the actual requirements:
- 5 tickers
- 3 runs per day
- 1 user (me)
- $0 budget

My current solution:
- 1 SQLite file (660KB)
- 1 Python process
- 1 Docker container

All that distributed systems complexity would have taken weeks to build and would solve exactly zero problems I actually have. This is a personal trading bot, not a hedge fund's infrastructure.

## When this approach doesn't work

This is appropriate for:
- Personal hobby projects
- Single-user systems
- 5-10 tickers at most
- Educational purposes

Don't use this architecture for:
- Production trading systems (use TimescaleDB or InfluxDB)
- Multi-user applications (you need proper auth, PostgreSQL, audit logs)
- Regulated environments (immutable records, compliance tracking)
- Real money trading (you need real-time data, not 8-hour polling intervals)

I'm comfortable with SQLite because if the database corrupts, I can just refetch 60 days of data and be back up in minutes. That's not an acceptable failure mode for actual financial infrastructure.

## How it all fits together

```
┌─────────────────────────────────────────────────────────────┐
│                     Docker Container                         │
│                                                              │
│  ┌──────────────────┐         ┌──────────────────┐         │
│  │  Signal Service  │◄────────┤   SQLite DB      │         │
│  │  (runs every 8h) │         │  (660 KB file)   │         │
│  │                  │         │                  │         │
│  │ • Rate limiter   │         │ • 535 candles/   │         │
│  │ • State machine  │         │   ticker         │         │
│  │ • Alert sender   │         │ • PRIMARY KEY    │         │
│  └────────┬─────────┘         │   (ticker, dt)   │         │
│           │                   └──────────────────┘         │
│           │                            ▲                    │
│           │ Incremental fetch          │                    │
│           │ (3-8 candles/run)          │ Read full history │
│           │                            │                    │
│  ┌────────▼────────┐          ┌────────┴─────────┐         │
│  │  Yahoo Finance  │          │  Streamlit UI    │         │
│  │  (yfinance)     │          │  (port 8501)     │         │
│  │                 │          │                  │         │
│  │ • ~48 req/24h   │          │ • Stateless      │         │
│  │ • Volume-based  │          │ • Visualization  │         │
│  │   throttling    │          │ • Same calc code │         │
│  └─────────────────┘          └──────────────────┘         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## The numbers

Here's what 1,004 lines of Python bought me:

```
bollinger_bands_signal/
├── data_fetcher.py       219 lines  (Incremental logic - this is the complexity)
├── database.py           207 lines  (SQLite wrapper)
├── rate_limiter.py        57 lines  (Sliding window)
├── strategy.py            52 lines  (Bollinger Bands + state machine)
├── signal_service.py     196 lines  (Orchestration)
└── streamlit_display.py  113 lines  (UI)
                        ─────────────
Total:                  1,004 lines
```

The incremental fetcher and database code - the stuff I didn't want to write - is 426 lines, or 42% of the codebase. The actual trading strategy is 52 lines.

Test coverage is 16% overall, 83% for `data_fetcher.py`. I tested the risky state management code and ignored the straightforward pandas calculations.

## Performance in production

After running this for several weeks:

| Metric | First Run | Steady State |
|--------|-----------|--------------|
| API Requests/Day | 5 | 15 (3 runs × 5 tickers) |
| Data Downloaded/Request | 1,440 candles | 3-8 candles |
| Execution Time/Ticker | ~2.5 sec | ~0.6 sec |
| Database Size | 3.3 MB | +10 KB/day |
| Rate Limit Violations | 0 | 0 |

The first run downloads 60 days of data for each ticker (1,440 hourly candles). Every subsequent run only fetches 3-8 new candles. That's a 99.5% reduction in data volume, keeping me well under the ~48 requests/24h limit I discovered through testing.

## Wrapping up

I started wanting to build a 50-line stateless script. I ended up with 1,004 lines and a database. The incremental update logic I didn't want to write is now 42% of the codebase.

But it works. Zero rate limit violations across weeks of production use. The constraints - undocumented API rate limits based on data volume, not request count - dictated the architecture.

If I were building this again with a budget, I'd pay for a proper financial data API (Polygon.io charges $30/month for real-time data) and stick with the simple stateless design. But for a hobby project, the complexity tradeoff makes sense.

The lesson here isn't "always add incremental updates" or "never use free APIs." It's that API constraints aren't always what the documentation says they are, and discovering the real constraints requires systematic empirical testing. Once you know the real limits, you can make informed decisions about whether added complexity is worth it.

In my case: 426 lines of state management code to work around aggressive volume-based throttling on a free API. Not beautiful, but pragmatic.

---

The code is in my [nosehair-finance repository](https://github.com/) (link would go here). If you're curious about the testing methodology I used to map Yahoo Finance's rate limits, or how I structured the incremental update logic, the commit history shows the evolution from simple to complex.
