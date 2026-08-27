import React, { useEffect, useRef } from "react";
import { usePQTheme, type QuantumTheme } from "../../context/PQThemeContext";

interface ThemeColors {
  primary: string;
  secondary: string;
  glow: string;
  particle: string;
}

const THEME_PALETTES: Record<QuantumTheme, ThemeColors> = {
  cyan: {
    primary: "#00f0ff",
    secondary: "#3b82f6",
    glow: "rgba(0, 240, 255, 0.35)",
    particle: "#38bdf8",
  },
  violet: {
    primary: "#c084fc",
    secondary: "#e879f9",
    glow: "rgba(192, 132, 252, 0.35)",
    particle: "#f0abfc",
  },
  emerald: {
    primary: "#34d399",
    secondary: "#10b981",
    glow: "rgba(52, 211, 153, 0.35)",
    particle: "#6ee7b7",
  },
  amber: {
    primary: "#fbbf24",
    secondary: "#f59e0b",
    glow: "rgba(251, 191, 36, 0.35)",
    particle: "#fde047",
  },
};

export const AtomicBackground: React.FC = () => {
  const { isThemeActive, backgroundFxEnabled, quantumTheme } = usePQTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!isThemeActive || !backgroundFxEnabled) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", handleResize);

    // Particle setup
    const particleCount = Math.min(Math.floor((width * height) / 18000), 65);
    const particles = Array.from({ length: particleCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      radius: Math.random() * 1.8 + 0.8,
      pulseSpeed: Math.random() * 0.03 + 0.01,
      pulse: Math.random() * Math.PI,
    }));

    // Orbit rings setup
    const orbits = [
      { rx: 240, ry: 90, tilt: 0.35, speed: 0.008 },
      { rx: 260, ry: 100, tilt: -0.65, speed: -0.011 },
      { rx: 220, ry: 80, tilt: 1.15, speed: 0.014 },
    ];

    let angle = 0;

    const render = () => {
      const colors = THEME_PALETTES[quantumTheme] || THEME_PALETTES.cyan;
      ctx.clearRect(0, 0, width, height);

      const centerX = width * 0.85; // Off-center right for dynamic visual balance
      const centerY = height * 0.25;

      // 1. Draw glowing quantum nucleus in top-right area
      const nucleusGradient = ctx.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        180
      );
      nucleusGradient.addColorStop(0, colors.glow);
      nucleusGradient.addColorStop(0.4, colors.glow.replace("0.35)", "0.08)"));
      nucleusGradient.addColorStop(1, "transparent");

      ctx.fillStyle = nucleusGradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, 180, 0, Math.PI * 2);
      ctx.fill();

      // Nucleus core pulse
      const corePulse = Math.sin(angle * 3) * 3 + 12;
      ctx.fillStyle = colors.primary;
      ctx.shadowColor = colors.primary;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(centerX, centerY, corePulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // 2. Draw spinning 3D atomic orbital rings & electrons
      angle += 0.01;

      orbits.forEach((orbit, i) => {
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(orbit.tilt);

        // Orbit ring path
        ctx.strokeStyle = colors.glow;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.ellipse(0, 0, orbit.rx, orbit.ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Orbiting electron particle
        const electronAngle = angle * orbit.speed * 80 + i * 2.1;
        const ex = orbit.rx * Math.cos(electronAngle);
        const ey = orbit.ry * Math.sin(electronAngle);

        // Electron glow
        ctx.fillStyle = colors.primary;
        ctx.shadowColor = colors.primary;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(ex, ey, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.restore();
      });

      // 3. Draw subatomic floating background particles & quantum wave field
      particles.forEach((p, idx) => {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        p.pulse += p.pulseSpeed;
        const currentRadius = p.radius + Math.sin(p.pulse) * 0.5;

        ctx.fillStyle = colors.particle;
        ctx.globalAlpha = 0.25 + Math.sin(p.pulse) * 0.15;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, currentRadius), 0, Math.PI * 2);
        ctx.fill();

        // Connect close particles with subtle energy threads
        for (let j = idx + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 110) {
            ctx.strokeStyle = colors.primary;
            ctx.globalAlpha = (1 - dist / 110) * 0.12;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      });

      ctx.globalAlpha = 1.0;
      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [isThemeActive, backgroundFxEnabled, quantumTheme]);

  if (!isThemeActive || !backgroundFxEnabled) return null;

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0 transition-opacity duration-1000 opacity-80"
    />
  );
};
