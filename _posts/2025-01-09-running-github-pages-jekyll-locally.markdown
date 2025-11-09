---
layout: post
title: "Getting Jekyll to work locally with GitHub Pages and Ruby 3.4"
date: 2025-01-09 10:48:00 -0700
categories: jekyll github-pages development
---

I spent an afternoon getting my GitHub Pages blog running locally. It _should_ have been straightforward - run `bundle exec jekyll serve` and you're done. Instead, I hit five separate issues that took me down a rabbit hole of Ruby standard library changes, SSL certificate errors, and missing layouts.

Here's what I learned about running Jekyll 3.10.0 (the version GitHub Pages uses) with Ruby 3.4.3 in January 2025.

## The "cannot load such file -- csv" error

First error after `bundle install`:

```
bundler: failed to load command: jekyll
~/.asdf/installs/ruby/3.4.3/lib/ruby/3.4.0/bundled_gems.rb:82:
in 'Kernel.require': cannot load such file -- csv (LoadError)
```

This was confusing because `csv` is a Ruby standard library - why would it be missing? Turns out Ruby 3.4 removed several gems from the default bundle. They're still available, but you have to declare them explicitly in your `Gemfile`.

I added `csv` and tried again. Then I got the same error for `logger`. Then `bigdecimal`. Each time, I had to add another gem to the `Gemfile` and run `bundle install` again.

Here's what I ended up adding:

```ruby
# Ruby 3.4+ compatibility
gem "csv"
gem "logger"
gem "base64"
gem "webrick"
gem "bigdecimal"
```

Five gems that used to be bundled with Ruby but aren't anymore. This is a breaking change in Ruby 3.4 that affects any Jekyll site - not just GitHub Pages.

## The SSL certificate error with remote_theme

With the missing gems fixed, Jekyll finally started... then immediately crashed with an SSL error:

```
SSL_connect returned=1 errno=0 peeraddr=140.82.121.9:443
state=error: certificate verify failed (unable to get certificate CRL)
```

This happened because my `_config.yml` was using `remote_theme: pages-themes/midnight@v0.2.0` to load the theme from GitHub. Jekyll tried to download it at startup and failed with a certificate verification error.

The fix was switching from `remote_theme` to `theme`:

```yaml
# Instead of:
remote_theme: pages-themes/midnight@v0.2.0
plugins:
  - jekyll-remote-theme

# Use:
theme: jekyll-theme-midnight
plugins:
  - jekyll-feed
```

This works because the `github-pages` gem (which I already had in my `Gemfile`) includes all 13 official GitHub Pages themes as dependencies. You can verify this:

```bash
$ gem list | grep jekyll-theme
jekyll-theme-architect (0.2.0)
jekyll-theme-cayman (0.2.0)
jekyll-theme-dinky (0.2.0)
jekyll-theme-hacker (0.2.0)
jekyll-theme-leap-day (0.2.0)
jekyll-theme-merlot (0.2.0)
jekyll-theme-midnight (0.2.0)
jekyll-theme-minimal (0.2.0)
jekyll-theme-modernist (0.2.0)
jekyll-theme-primer (0.6.0)
jekyll-theme-slate (0.2.0)
jekyll-theme-tactile (0.2.0)
jekyll-theme-time-machine (0.2.0)
```

They're all already installed. No download needed.

Interestingly, this configuration works on GitHub Pages too - GitHub recognizes `theme: jekyll-theme-midnight` and uses it, even though the theme's repository recommends using `remote_theme` in their README.

## Build warnings about missing layouts

The server finally started! But I saw warnings in the output:

```
Build Warning: Layout 'post' requested in _posts/2019-10-08-first-post.markdown does not exist.
Build Warning: Layout 'page' requested in about.md does not exist.
Build Warning: Layout 'home' requested in index.md does not exist.
```

When I checked the site at `http://127.0.0.1:4000/`, the page was blank. Well, not _blank_ - the header and footer from the midnight theme were there, but none of my content appeared.

I checked what layouts the midnight theme actually provides:

```bash
$ bundle info jekyll-theme-midnight
Path: ~/.asdf/installs/ruby/3.4.3/lib/ruby/gems/3.4.0/gems/jekyll-theme-midnight-0.2.0

$ ls -la ~/.asdf/installs/ruby/3.4.3/lib/ruby/gems/3.4.0/gems/jekyll-theme-midnight-0.2.0/_layouts/
total 8
drwxr-xr-x@ 3 user  staff    96 Nov  8 23:39 .
drwxr-xr-x@ 8 user  staff   256 Nov  8 23:39 ..
-rw-r--r--@ 1 user  staff  1996 Nov  8 23:39 default.html
```

Just `default.html`. No `post`, `page`, or `home` layouts.

This surprised me because most Jekyll themes include these. The midnight theme expects you to create them yourself. I created three files in `_layouts/` - each with `layout: default` in the front matter to extend the theme's base layout, then added the HTML structure for post metadata, page titles, and the home page's post list.

Jekyll's auto-regeneration picked up the new files and the site started working.

## The config file doesn't auto-reload problem

I wanted to change my site title, so I edited `_config.yml` and... nothing happened. The page still showed the old title.

I checked the server output - no regeneration. I waited a minute. Still nothing.

Turns out Jekyll's auto-regeneration specifically _doesn't_ watch `_config.yml`. From the [Jekyll documentation](https://jekyllrb.com/docs/configuration/options/#serve-command-options):

> Please note that changes to _config.yml (or the config file you have specified) are not included during automatic regeneration.

This makes sense - many config changes require rebuilding the entire site state, not just regenerating pages. But it's not obvious if you're expecting everything to hot-reload.

I had to kill the server with `pkill -f "jekyll serve"` and restart it. Then the changes appeared.

## The browser caching made me think it still wasn't working

Even after I restarted Jekyll with the correct config, my browser still showed the old title. I refreshed. Still old. I checked the server logs - it had regenerated with the new config. I curled `http://127.0.0.1:4000/` and saw the new title in the HTML.

Aggressive browser caching. A hard refresh (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows) fixed it.

This happened _multiple times_ during my debugging session. I'd make a change, restart Jekyll, see it hadn't updated, spend five minutes investigating, then realize I just needed to hard refresh the browser.

## LiveReload fixes the refresh problem

After the third time hitting this, I added `--livereload` to the Jekyll command:

```bash
bundle exec jekyll serve --livereload
```

This starts a WebSocket server on port 35729 that notifies your browser when files change. You can verify it's working:

```bash
$ lsof -i :35729
COMMAND   PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
ruby    60789   gabor   10u  IPv4 0xa2f0a7c06281b31d      0t0  TCP localhost:35729 (LISTEN)
```

Now when I save a file, the browser automatically refreshes within 1-2 seconds. Much better development experience.

Note that `--livereload` _doesn't_ help with `_config.yml` changes - you still need to restart for those. But it handles everything else: posts, pages, layouts, CSS, even new files.

## The final working configuration

Here's my complete `Gemfile`:

```ruby
source "https://rubygems.org"

gem "github-pages", group: :jekyll_plugins

group :jekyll_plugins do
  gem "jekyll-feed"
  gem "jekyll-remote-theme"
end

# Ruby 3.4+ compatibility
gem "csv"
gem "logger"
gem "base64"
gem "webrick"
gem "bigdecimal"
```

And the theme configuration in `_config.yml`:

```yaml
theme: jekyll-theme-midnight
plugins:
  - jekyll-feed
```

With custom layouts in `_layouts/post.html`, `_layouts/page.html`, and `_layouts/home.html`.

To run locally:

```bash
bundle install
bundle exec jekyll serve --livereload
```

This configuration works identically on GitHub Pages. The `github-pages` gem uses the same versions as GitHub's production environment, so what you see locally is what you'll get when you push.

## Why this matters

The combination of Ruby 3.4 removing standard library gems and GitHub Pages still using Jekyll 3.10.0 creates a dependency mismatch that isn't immediately obvious. The error messages point to missing files, not version incompatibilities.

The `remote_theme` vs `theme` issue is subtle too - `remote_theme` works on GitHub Pages because GitHub has proper SSL certificates for its own API. But locally, something in the certificate chain fails. Using `theme` with the `github-pages` gem sidesteps this entirely.

And the missing layouts issue? That's theme-specific. The midnight theme is minimal by design, but it's not obvious that "minimal" means "only includes one layout." Other themes (like minima, cayman, slate) include post/page/home layouts out of the box.

## Debugging commands I used

These were helpful while figuring this out:

```bash
# Check installed theme location and version
bundle info jekyll-theme-midnight

# List all installed Jekyll themes
gem list | grep jekyll-theme

# Force complete rebuild (clears caches)
rm -rf _site .jekyll-cache && bundle exec jekyll serve

# Check what's running on Jekyll ports
lsof -i :4000   # Main server
lsof -i :35729  # LiveReload

# Find Jekyll processes
ps aux | grep jekyll
```

The `bundle info` command was particularly useful for finding the theme's installation directory so I could see what layouts it actually provided.

## What I'd do differently

If I were setting this up from scratch, I'd:

1. Start with Ruby 3.4 compatibility gems in the `Gemfile` from day one
2. Use `theme` instead of `remote_theme` even though GitHub's docs suggest `remote_theme`
3. Check what layouts a theme provides before assuming standard ones exist
4. Always run Jekyll with `--livereload` for local development
5. Set up a shell alias: `alias jekyll-serve="bundle exec jekyll serve --livereload"`

The entire setup took about two hours, mostly because each issue appeared sequentially. If I'd known about all five issues upfront, it would have been 10 minutes of configuration.

That's the nature of dependency management though - you don't know what's broken until you try to run it.
