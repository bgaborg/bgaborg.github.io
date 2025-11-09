// Morphing background with grey dots on black background
// Simple and performant 3D particle system

type ParticleShape = 'circle' | 'square' | 'x' | 'triangle';

interface Particle {
  x: number;
  y: number;
  z: number;
  baseX: number;
  baseY: number;
  baseZ: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  angle: number;
  speed: number;
  radiusX: number;
  radiusY: number;
  radiusZ: number;
  shape: ParticleShape;
  rotation: number;
  rotationSpeed: number;
  vx: number;
  vy: number;
  vz: number;
}

interface GravityPoint {
  x: number;
  y: number;
  z: number;
  strength: number;
}

class MorphingBackground {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private particleCount = 300;
  private gravityPoints: GravityPoint[] = [];
  private gravityPointCount = 10;
  private mouseX = 0;
  private mouseY = 0;
  private animationId: number | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'morphing-bg';
    this.canvas.style.position = 'fixed';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.zIndex = '-1';
    this.canvas.style.background = '#000';

    document.body.insertBefore(this.canvas, document.body.firstChild);

    this.ctx = this.canvas.getContext('2d')!;

    this.resize();
    this.initGravityPoints();
    this.initParticles();
    this.setupEventListeners();
    this.animate();
  }

  private resize(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  private initGravityPoints(): void {
    this.gravityPoints = [];

    // Create a grid to distribute gravity points evenly
    const cols = Math.ceil(Math.sqrt(this.gravityPointCount));
    const rows = Math.ceil(this.gravityPointCount / cols);
    const cellWidth = this.canvas.width / cols;
    const cellHeight = this.canvas.height / rows;

    for (let i = 0; i < this.gravityPointCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);

      // Place gravity point randomly within its grid cell
      const x = col * cellWidth + Math.random() * cellWidth;
      const y = row * cellHeight + Math.random() * cellHeight;
      const z = Math.random() * 800 - 200;

      this.gravityPoints.push({
        x: x,
        y: y,
        z: z,
        strength: 0.5 + Math.random() * 1.5, // Random strength between 0.5 and 2.0
      });
    }
  }

  private initParticles(): void {
    this.particles = [];

    for (let i = 0; i < this.particleCount; i++) {
      const baseX = Math.random() * this.canvas.width;
      const baseY = Math.random() * this.canvas.height;
      const baseZ = Math.random() * 800 - 200; // Range from -200 to 600

      const particle: Particle = {
        x: baseX,
        y: baseY,
        z: baseZ,
        baseX: baseX,
        baseY: baseY,
        baseZ: baseZ,
        offsetX: Math.random() * Math.PI * 2,
        offsetY: Math.random() * Math.PI * 2,
        offsetZ: Math.random() * Math.PI * 2,
        angle: Math.random() * Math.PI * 2,
        speed: 0.0001 + Math.random() * 0.0002,
        radiusX: 20 + Math.random() * 50,
        radiusY: 20 + Math.random() * 50,
        radiusZ: 10 + Math.random() * 30,
        shape: 'circle',
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.002,
        vx: 0,
        vy: 0,
        vz: 0,
      };
      this.particles.push(particle);
    }
  }

  private setupEventListeners(): void {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
  }

  private updateParticle(p: Particle): void {
    // Each particle follows its own circular/elliptical path
    // Update angle based on particle's individual speed
    p.angle += p.speed;

    // Update rotation
    p.rotation += p.rotationSpeed;

    // Calculate base position on elliptical path using Lissajous curves
    const targetX = p.baseX + Math.sin(p.angle + p.offsetX) * p.radiusX;
    const targetY = p.baseY + Math.sin(p.angle * 1.3 + p.offsetY) * p.radiusY;
    const targetZ = p.baseZ + Math.sin(p.angle * 0.7 + p.offsetZ) * p.radiusZ;

    // Apply gravitational forces from all gravity points
    let forceX = 0;
    let forceY = 0;
    let forceZ = 0;

    for (const gp of this.gravityPoints) {
      const dx = gp.x - targetX;
      const dy = gp.y - targetY;
      const dz = gp.z - targetZ;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      const distance = Math.sqrt(distanceSq);

      // Minimum distance to prevent extreme forces
      const minDistance = 100;
      if (distance > minDistance) {
        // Gentler gravitational force with distance falloff
        const force = (gp.strength * 0.1) / Math.max(distanceSq * 0.001, 1);
        forceX += (dx / distance) * force;
        forceY += (dy / distance) * force;
        forceZ += (dz / distance) * force;
      }
    }

    // Update velocities with gravity
    p.vx += forceX;
    p.vy += forceY;
    p.vz += forceZ;

    // Apply stronger damping to prevent oscillation
    p.vx *= 0.85;
    p.vy *= 0.85;
    p.vz *= 0.85;

    // Clamp velocity to prevent extreme speeds
    const maxVelocity = 5;
    p.vx = Math.max(-maxVelocity, Math.min(maxVelocity, p.vx));
    p.vy = Math.max(-maxVelocity, Math.min(maxVelocity, p.vy));
    p.vz = Math.max(-maxVelocity, Math.min(maxVelocity, p.vz));

    // Update position with velocity
    p.x = targetX + p.vx;
    p.y = targetY + p.vy;
    p.z = targetZ + p.vz;

    // Keep particles within bounds by wrapping
    if (p.x < -50) p.baseX += this.canvas.width + 100;
    if (p.x > this.canvas.width + 50) p.baseX -= this.canvas.width + 100;
    if (p.y < -50) p.baseY += this.canvas.height + 100;
    if (p.y > this.canvas.height + 50) p.baseY -= this.canvas.height + 100;
    if (p.z < -300) p.baseZ += 1000;
    if (p.z > 700) p.baseZ -= 1000;
  }

  private drawParticle(p: Particle): void {
    // 3D projection - simple perspective
    const scale = 500 / (500 + p.z);
    const x = p.x * scale + (this.canvas.width * (1 - scale)) / 2;
    const y = p.y * scale + (this.canvas.height * (1 - scale)) / 2;
    const size = 1 + 1 * scale;

    // Normalize z from range [-200, 600] to [0, 1] where 0 is far, 1 is near
    const normalizedZ = 1 - (p.z + 200) / 800;
    const brightness = 255; // Pure white stars
    const alpha = 0.6 + normalizedZ * 0.4; // Vary intensity by depth

    this.ctx.save();
    this.ctx.translate(x, y);

    // Draw natural star glow with softer falloff
    const glowRadius = size * 6;
    const gradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, glowRadius);
    gradient.addColorStop(
      0,
      `rgba(${brightness}, ${brightness}, ${brightness}, ${alpha})`,
    );
    gradient.addColorStop(
      0.1,
      `rgba(${brightness}, ${brightness}, ${brightness}, ${alpha * 0.6})`,
    );
    gradient.addColorStop(
      0.3,
      `rgba(${brightness}, ${brightness}, ${brightness}, ${alpha * 0.2})`,
    );
    gradient.addColorStop(
      0.6,
      `rgba(${brightness}, ${brightness}, ${brightness}, ${alpha * 0.05})`,
    );
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    // Draw the glow
    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(0, 0, glowRadius, 0, Math.PI * 2);
    this.ctx.fill();

    // Draw bright center point
    this.ctx.fillStyle = `rgba(${brightness}, ${brightness}, ${brightness}, 1)`;
    this.ctx.beginPath();
    this.ctx.arc(0, 0, size * 0.4, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.restore();
  }

  private animate = (): void => {
    // Clear with black background
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Update and draw particles
    for (const particle of this.particles) {
      this.updateParticle(particle);
      this.drawParticle(particle);
    }

    // Draw connections between nearby particles
    this.drawConnections();

    this.animationId = requestAnimationFrame(this.animate);
  };

  private drawConnections(): void {
    const maxDistance = 150;

    for (let i = 0; i < this.particles.length; i++) {
      for (let j = i + 1; j < this.particles.length; j++) {
        const p1 = this.particles[i];
        const p2 = this.particles[j];

        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const dz = p1.z - p2.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (distance < maxDistance) {
          // Make constellation lines much more visible
          const alpha = (1 - distance / maxDistance) * 0.8;

          const scale1 = 500 / (500 + p1.z);
          const scale2 = 500 / (500 + p2.z);

          const x1 = p1.x * scale1 + (this.canvas.width * (1 - scale1)) / 2;
          const y1 = p1.y * scale1 + (this.canvas.height * (1 - scale1)) / 2;
          const x2 = p2.x * scale2 + (this.canvas.width * (1 - scale2)) / 2;
          const y2 = p2.y * scale2 + (this.canvas.height * (1 - scale2)) / 2;

          // Draw main constellation line - bright white/blue like real constellations
          this.ctx.strokeStyle = `rgba(180, 200, 255, ${alpha})`;
          this.ctx.lineWidth = 1.5;
          this.ctx.beginPath();
          this.ctx.moveTo(x1, y1);
          this.ctx.lineTo(x2, y2);
          this.ctx.stroke();

          // Add subtle glow to constellation lines
          this.ctx.strokeStyle = `rgba(200, 220, 255, ${alpha * 0.3})`;
          this.ctx.lineWidth = 3;
          this.ctx.beginPath();
          this.ctx.moveTo(x1, y1);
          this.ctx.lineTo(x2, y2);
          this.ctx.stroke();
        }
      }
    }
  }

  public destroy(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }
    this.canvas.remove();
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new MorphingBackground();
  });
} else {
  new MorphingBackground();
}
