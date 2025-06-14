import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, RotateCcw, Trophy, Map } from 'lucide-react';

// Game constants
const CONFIG = {
  WORLD_W: 2000, WORLD_H: 2000,
  SNAKE_SPEED: 2.5, BOOST_SPEED: 4.5, TURN_SPEED: 0.1,

  MIN_SNAKE_WIDTH: 10,
  MAX_SNAKE_WIDTH: 35,
  SCORE_FOR_MAX_WIDTH: 2000,

  MIN_SNAKE_LENGTH: 10,
  MAX_SNAKE_LENGTH: 150,
  SCORE_FOR_MAX_LENGTH: 2000,

  MIN_TURN_RADIUS: 2.5, MAX_TURN_RADIUS: 15,
  FOOD_COUNT: 200, AI_COUNT: 15, 
  
  COLORS: {
    BG: '#000000', GRID: '#222222', 
    PLAYER: ['#00ff88', '#00dd77', '#00bb66'],
    AI: ['#ff4444', '#4444ff', '#ffaa00', '#ff44ff', '#44ffff'],
    FOOD: ['#ffff00', '#ff8800', '#ff0088', '#8800ff'],
    POWER_FOOD: '#ff0000',
    MINIMAP_BG: 'rgba(50, 50, 50, 0.5)',
    MINIMAP_BORDER: '#888',
    MINIMAP_CAMERA: 'rgba(255, 255, 255, 0.3)',
  }
};

// Utility functions
const dist = (x1, y1, x2, y2) => Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
const angle = (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Game classes
class GameObject {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.id = Math.random();
  }
}

class Food extends GameObject {
  constructor(x, y, type = 'normal', color = null) {
    super(x, y);
    this.type = type;
    this.size = type === 'power' ? 8 : 3 + Math.random() * 2;
    this.color = color || (type === 'power' ? CONFIG.COLORS.POWER_FOOD :
      CONFIG.COLORS.FOOD[Math.floor(Math.random() * CONFIG.COLORS.FOOD.length)]);
    this.value = type === 'power' ? 5 : 1;
    this.pulse = Math.random() * Math.PI * 2;
    this.sparkles = type === 'power' ? [] : null;

    if (type === 'power') {
      for (let i = 0; i < 6; i++) {
        this.sparkles.push({
          angle: (i / 6) * Math.PI * 2,
          distance: 0,
          phase: Math.random() * Math.PI * 2
        });
      }
    }
  }

  update() {
    this.pulse += 0.1;
    if (this.sparkles) {
      this.sparkles.forEach(sparkle => {
        sparkle.phase += 0.2;
        sparkle.distance = 15 + Math.sin(sparkle.phase) * 5;
      });
    }
  }

  getSize() {
    return this.size + Math.sin(this.pulse) * (this.type === 'power' ? 2 : 0.5);
  }
}

class Snake extends GameObject {
  constructor(x, y, isPlayer = false) {
    super(x, y);
    this.segments = [{ x, y, angle: 0 }];
    this.angle = Math.random() * Math.PI * 2;
    this.targetAngle = this.angle;
    this.speed = CONFIG.SNAKE_SPEED;
    this.score = 0;
    this.isPlayer = isPlayer;
    this.isAlive = true;
    this.boost = 100;
    this.invulnerable = 0;
    this.magnetism = 0;
    this.colors = isPlayer ? CONFIG.COLORS.PLAYER :
      CONFIG.COLORS.AI[Math.floor(Math.random() * CONFIG.COLORS.AI.length)];

    this.aiTarget = null;
    this.aiTimer = 0;

    for (let i = 1; i < CONFIG.MIN_SNAKE_LENGTH; i++) {
      const prev = this.segments[i - 1];
      const desiredDist = this.getWidth() * 0.7;
      this.segments.push({
        x: prev.x - Math.cos(this.angle) * desiredDist,
        y: prev.y - Math.sin(this.angle) * desiredDist,
        angle: this.angle
      });
    }
  }

  getWidth() {
    const growthProgress = Math.min(1, Math.sqrt(this.score / CONFIG.SCORE_FOR_MAX_WIDTH));
    return lerp(CONFIG.MIN_SNAKE_WIDTH, CONFIG.MAX_SNAKE_WIDTH, growthProgress);
  }

  getLength() {
    const growthProgress = Math.min(1, Math.sqrt(this.score / CONFIG.SCORE_FOR_MAX_LENGTH));
    return Math.floor(lerp(CONFIG.MIN_SNAKE_LENGTH, CONFIG.MAX_SNAKE_LENGTH, growthProgress));
  }

  update(dt, gameState) {
    if (!this.isAlive) return;

    this.aiTimer += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.magnetism = Math.max(0, this.magnetism - dt);

    if (!this.isPlayer) this.updateAI(gameState);

    const sizeBasedTurnLimit = lerp(CONFIG.MIN_TURN_RADIUS, CONFIG.MAX_TURN_RADIUS,
      Math.min(1, this.segments.length / 50));

    let angleDiff = this.targetAngle - this.angle;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    const maxTurn = sizeBasedTurnLimit * dt;
    angleDiff = clamp(angleDiff, -maxTurn, maxTurn);
    this.angle += angleDiff;

    const head = this.segments[0];
    head.x += Math.cos(this.angle) * this.speed * dt;
    head.y += Math.sin(this.angle) * this.speed * dt;
    head.angle = this.angle;

    if (this.magnetism > 0 && this.isPlayer) {
      gameState.food.forEach(food => {
        const d = dist(head.x, head.y, food.x, food.y);
        if (d < 150) {
          const pullForce = (2000 - d) / 1000 * 2;
          const pullAngle = angle(food.x, food.y, head.x, head.y);
          food.x += Math.cos(pullAngle) * pullForce;
          food.y += Math.sin(pullAngle) * pullForce;
        }
      });
    }

    for (let i = 1; i < this.segments.length; i++) {
      const curr = this.segments[i];
      const prev = this.segments[i - 1];
      const d = dist(curr.x, curr.y, prev.x, prev.y);

      const desiredDist = this.getWidth() * 0.7;

      if (d > desiredDist) {
        const moveAngle = angle(curr.x, curr.y, prev.x, prev.y);
        const moveDist = d - desiredDist;
        curr.x += Math.cos(moveAngle) * moveDist;
        curr.y += Math.sin(moveAngle) * moveDist;
        curr.angle = moveAngle;
      }
    }

    while (this.segments.length < this.getLength()) {
      const last = this.segments[this.segments.length - 1];
      const desiredDist = this.getWidth() * 0.7;
      this.segments.push({
        x: last.x - Math.cos(last.angle) * desiredDist,
        y: last.y - Math.sin(last.angle) * desiredDist,
        angle: last.angle
      });
    }

    if (this.speed > CONFIG.BOOST_SPEED && this.boost > 0) {
      this.boost -= 0.5 * dt;
    } else if (this.boost < 100) {
      this.boost += 0.2 * dt;
    }
    this.boost = clamp(this.boost, 0, 100);
  }

  updateAI(gameState) {
    const head = this.segments[0];
    const nearFood = gameState.food.filter(f => dist(head.x, head.y, f.x, f.y) < 200);
    const nearSnakes = gameState.snakes.filter(s =>
      s.id !== this.id && s.isAlive && dist(head.x, head.y, s.segments[0].x, s.segments[0].y) < 150
    );

    if (nearSnakes.length > 0) {
      const nearest = nearSnakes[0];
      const avoidAngle = angle(nearest.segments[0].x, nearest.segments[0].y, head.x, head.y);
      this.targetAngle = avoidAngle;
      this.speed = CONFIG.BOOST_SPEED;
    } else if (nearFood.length > 0) {
      const nearest = nearFood.reduce((closest, food) =>
        dist(head.x, head.y, food.x, food.y) < dist(head.x, head.y, closest.x, closest.y) ? food : closest
      );
      this.targetAngle = angle(head.x, head.y, nearest.x, nearest.y);
      this.speed = CONFIG.SNAKE_SPEED;
    } else if (this.aiTimer > 100 || !this.aiTarget) {
      this.targetAngle = this.angle + (Math.random() - 0.5) * 0.5;
      this.aiTimer = 0;
      this.speed = CONFIG.SNAKE_SPEED;
    }
  }

  checkCollision(other) {
    if (!this.isAlive || !other.isAlive || this.id === other.id || this.invulnerable > 0) return false;
    const head = this.segments[0];
    const headRadius = this.getWidth() / 2;

    return other.segments.slice(1).some(seg => {
      const segRadius = other.getWidth() / 2;
      return dist(head.x, head.y, seg.x, seg.y) < headRadius + segRadius;
    });
  }

  grow(amount = 1) {
    this.score += amount;
  }

  activatePower(type) {
    switch (type) {
      case 'invulnerable': this.invulnerable = 200; break;
      case 'magnetism': this.magnetism = 300; break;
      case 'speed': this.boost = 100; break;
      default: break;
    }
  }

  setTarget(mouseX, mouseY, camX, camY) {
    if (!this.isPlayer) return;
    const head = this.segments[0];
    this.targetAngle = angle(head.x, head.y, mouseX + camX, mouseY + camY);
  }

  setBoost(boosting) {
    if (!this.isPlayer) return;
    this.speed = boosting && this.boost > 0 ? CONFIG.BOOST_SPEED : CONFIG.SNAKE_SPEED;
  }

  checkFood(food) {
    if (!this.isAlive) return false;
    const head = this.segments[0];

    const headRadius = this.getWidth() / 2;
    const foodRadius = food.getSize();
    const maxDist = headRadius + foodRadius;
    const dx = food.x - head.x;
    const dy = food.y - head.y;
    const distSq = dx * dx + dy * dy;

    if (distSq > maxDist * maxDist) return false;

    const angleToFood = Math.atan2(dy, dx);
    let angleDiff = angleToFood - head.angle;
    angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
    const angleTolerance = Math.PI / 2.5;
    return Math.abs(angleDiff) < angleTolerance;
  }

  die() {
    this.isAlive = false;
  }
}

// Game Engine
class GameEngine {
  constructor() {
    this.snakes = [];
    this.food = [];
    this.camera = { x: 0, y: 0 };
    this.running = false;
    this.score = 0;
    this.canvasWidth = 800;
    this.canvasHeight = 600;
    this.init();
  }

  setCanvasSize(width, height) {
    this.canvasWidth = width;
    this.canvasHeight = height;
  }

  init() {
    this.snakes = [];
    this.food = [];
    this.mousePos = { x: this.canvasWidth / 2, y: this.canvasHeight / 2 };

    this.player = new Snake(CONFIG.WORLD_W / 2, CONFIG.WORLD_H / 2, true);
    this.snakes.push(this.player);

    for (let i = 0; i < CONFIG.AI_COUNT; i++) {
      this.snakes.push(new Snake(
        Math.random() * CONFIG.WORLD_W,
        Math.random() * CONFIG.WORLD_H
      ));
    }

    for (let i = 0; i < CONFIG.FOOD_COUNT; i++) {
      this.food.push(new Food(
        Math.random() * CONFIG.WORLD_W,
        Math.random() * CONFIG.WORLD_H
      ));
    }

    for (let i = 0; i < Math.floor(CONFIG.FOOD_COUNT * 0.05); i++) {
      this.food.push(new Food(
        Math.random() * CONFIG.WORLD_W,
        Math.random() * CONFIG.WORLD_H,
        'power'
      ));
    }
  }

  update() {
    if (!this.running) return;
    const dt = 1;

    this.snakes.forEach(snake => snake.update(dt, { snakes: this.snakes, food: this.food }));

    const newlyDeadSnakes = [];
    this.snakes.forEach(snake => {
      if (!snake.isAlive) return;
      const head = snake.segments[0];
      if (head.x < 0 || head.x > CONFIG.WORLD_W || head.y < 0 || head.y > CONFIG.WORLD_H) {
        snake.die();
        newlyDeadSnakes.push(snake);
        return;
      }
      for (const other of this.snakes) {
        if (snake.checkCollision(other)) {
          snake.die();
          newlyDeadSnakes.push(snake);
          return;
        }
      }
    });

    newlyDeadSnakes.forEach(deadSnake => {
      deadSnake.segments.forEach((segment, index) => {
        if (index % 3 === 0) {
          const foodColor = deadSnake.colors[index % deadSnake.colors.length];
          this.food.push(new Food(segment.x, segment.y, 'normal', foodColor));
        }
      });
    });

    this.snakes.forEach(snake => {
      if (!snake.isAlive) return;
      for (let i = this.food.length - 1; i >= 0; i--) {
        const food = this.food[i];
        if (snake.checkFood(food)) {
          snake.grow(food.value);
          if (food.type === 'power') {
            const powers = ['invulnerable', 'magnetism', 'speed'];
            snake.activatePower(powers[Math.floor(Math.random() * powers.length)]);
            this.food.splice(i, 1, new Food(Math.random() * CONFIG.WORLD_W, Math.random() * CONFIG.WORLD_H, 'power'));
          } else {
            this.food.splice(i, 1, new Food(Math.random() * CONFIG.WORLD_W, Math.random() * CONFIG.WORLD_H));
          }
        }
      }
    });

    this.food.forEach(food => food.update());

    if (this.player.isAlive) {
      const head = this.player.segments[0];
      this.camera.x = lerp(this.camera.x, head.x - this.canvasWidth / 2, 0.1);
      this.camera.y = lerp(this.camera.y, head.y - this.canvasHeight / 2, 0.1);
      this.score = this.player.score;
    }

    const aliveAI = this.snakes.filter(s => !s.isPlayer && s.isAlive).length;
    if (aliveAI < CONFIG.AI_COUNT) {
      this.snakes.push(new Snake(Math.random() * CONFIG.WORLD_W, Math.random() * CONFIG.WORLD_H));
    }
  }

  render(ctx, width, height) {
    ctx.fillStyle = CONFIG.COLORS.BG;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = CONFIG.COLORS.GRID;
    ctx.lineWidth = 1;
    const gridSize = 50;
    const startX = Math.floor(this.camera.x / gridSize) * gridSize;
    const startY = Math.floor(this.camera.y / gridSize) * gridSize;

    for (let x = startX; x < this.camera.x + width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x - this.camera.x, 0);
      ctx.lineTo(x - this.camera.x, height);
      ctx.stroke();
    }
    for (let y = startY; y < this.camera.y + height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y - this.camera.y);
      ctx.lineTo(width, y - this.camera.y);
      ctx.stroke();
    }

    this.food.forEach(food => {
      const x = food.x - this.camera.x;
      const y = food.y - this.camera.y;
      if (x > -20 && x < width + 20 && y > -20 && y < height + 20) {
        ctx.fillStyle = food.color;
        ctx.shadowColor = food.color;
        ctx.shadowBlur = food.type === 'power' ? 8 : 3;

        if (food.sparkles) {
          ctx.fillStyle = '#ffffff';
          food.sparkles.forEach(sparkle => {
            const sparkleX = x + Math.cos(sparkle.angle) * sparkle.distance;
            const sparkleY = y + Math.sin(sparkle.angle) * sparkle.distance;
            ctx.beginPath();
            ctx.arc(sparkleX, sparkleY, 1, 0, Math.PI * 2);
            ctx.fill();
          });
        }

        ctx.fillStyle = food.color;
        ctx.beginPath();
        ctx.arc(x, y, food.getSize(), 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });

    this.snakes.forEach(snake => {
      if (!snake.isAlive) return;
      const snakeWidth = snake.getWidth();
      snake.segments.forEach((segment, i) => {
        const x = segment.x - this.camera.x;
        const y = segment.y - this.camera.y;
        if (x > -snakeWidth && x < width + snakeWidth && y > -snakeWidth && y < height + snakeWidth) {
          const radius = (i === 0 ? snakeWidth * 1.2 : snakeWidth) / 2;
          const colorIndex = Math.min(i, snake.colors.length - 1);
          if (snake.invulnerable > 0) {
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 15;
            ctx.globalAlpha = 0.8 + Math.sin(Date.now() * 0.02) * 0.2;
          } else if (snake.magnetism > 0) {
            ctx.shadowColor = '#ffff00';
            ctx.shadowBlur = 10;
          }
          ctx.fillStyle = snake.colors[colorIndex];
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
          if (i === 0) {
            ctx.fillStyle = '#fff';
            const eyeRadius = radius * 0.2;
            const eyeOffset = radius * 0.5;
            ctx.beginPath();
            ctx.arc(x + Math.cos(segment.angle - 0.5) * eyeOffset, y + Math.sin(segment.angle - 0.5) * eyeOffset, eyeRadius, 0, Math.PI * 2);
            ctx.arc(x + Math.cos(segment.angle + 0.5) * eyeOffset, y + Math.sin(segment.angle + 0.5) * eyeOffset, eyeRadius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });
    });

    ctx.save();
    const pulse = 128 + Math.sin(Date.now() * 0.0085) * 64;
    ctx.strokeStyle = `rgba(255, ${pulse}, 0, 0.7)`;
    ctx.lineWidth = 6;
    ctx.setLineDash([10, 10]);
    ctx.strokeRect(-this.camera.x, -this.camera.y, CONFIG.WORLD_W, CONFIG.WORLD_H);
    ctx.setLineDash([]);
    ctx.restore();

    this.renderMinimap(ctx, width, height);
  }
  
  renderMinimap(ctx, canvasW, canvasH) {
    const mapW = 200;
    const mapH = 200;
    const mapX = canvasW - mapW - 20;
    const mapY = canvasH - mapH - 20;
    const scaleX = mapW / CONFIG.WORLD_W;
    const scaleY = mapH / CONFIG.WORLD_H;

    ctx.save();
    ctx.fillStyle = CONFIG.COLORS.MINIMAP_BG;
    ctx.strokeStyle = CONFIG.COLORS.MINIMAP_BORDER;
    ctx.lineWidth = 2;
    ctx.fillRect(mapX, mapY, mapW, mapH);
    ctx.strokeRect(mapX, mapY, mapW, mapH);
    
    this.snakes.forEach(snake => {
        if (!snake.isAlive) return;
        const head = snake.segments[0];
        const dotX = mapX + head.x * scaleX;
        const dotY = mapY + head.y * scaleY;
        ctx.fillStyle = snake.isPlayer ? CONFIG.COLORS.PLAYER[0] : snake.colors[0];
        ctx.beginPath();
        ctx.arc(dotX, dotY, 2, 0, Math.PI * 2);
        ctx.fill();
    });

    ctx.strokeStyle = CONFIG.COLORS.MINIMAP_CAMERA;
    ctx.lineWidth = 1;
    const camRectX = mapX + this.camera.x * scaleX;
    const camRectY = mapY + this.camera.y * scaleY;
    const camRectW = this.canvasWidth * scaleX;
    const camRectH = this.canvasHeight * scaleY;
    ctx.strokeRect(camRectX, camRectY, camRectW, camRectH);

    ctx.restore();
  }

  start() { this.running = true; }
  pause() { this.running = false; }
  reset() { this.running = false; this.score = 0; this.init(); }
  handleMouse(x, y) { if (this.player.isAlive) this.player.setTarget(x, y, this.camera.x, this.camera.y); }
  handleBoost(boosting) { if (this.player.isAlive) this.player.setBoost(boosting); }
  isGameOver() { return !this.player.isAlive; }

  getLeaderboard() {
    return this.snakes.filter(s => s.isAlive).sort((a, b) => b.score - a.score).slice(0, 10).map((s, i) => ({
      name: s.isPlayer ? 'You' : `AI ${this.snakes.indexOf(s)}`, score: s.score, isPlayer: s.isPlayer
    }));
  }

  getPlayerRank() {
    const sortedSnakes = this.snakes.filter(s => s.isAlive).sort((a, b) => b.score - a.score);
    const playerIndex = sortedSnakes.findIndex(s => s.isPlayer);
    return {
      rank: playerIndex + 1,
      total: sortedSnakes.length,
    };
  }
}

// React Component
const SlitherIOGame = () => {
  const canvasRef = useRef(null);
  const engineRef = useRef(new GameEngine());
  const animationRef = useRef();

  const [isRunning, setIsRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  const [playerRank, setPlayerRank] = useState({ rank: 0, total: 0});
  const [canvasSize, setCanvasSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  const gameLoop = useCallback(() => {
    const engine = engineRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) {
      engine.update();
      engine.render(ctx, canvas.width, canvas.height);
      setScore(engine.score);
      setGameOver(engine.isGameOver());
      setLeaderboard(engine.getLeaderboard());
      setPlayerRank(engine.getPlayerRank());
    }
    animationRef.current = requestAnimationFrame(gameLoop);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const newSize = { width: window.innerWidth, height: window.innerHeight };
      setCanvasSize(newSize);
      engineRef.current.setCanvasSize(newSize.width, newSize.height);
    };
    window.addEventListener('resize', handleResize);
    handleResize(); // Initial size
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (isRunning) {
      engineRef.current.start();
      animationRef.current = requestAnimationFrame(gameLoop);
    } else {
      engineRef.current.pause();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    }
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [isRunning, gameLoop]);

  const handleMouseMove = useCallback((e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) engineRef.current.handleMouse(e.clientX - rect.left, e.clientY - rect.top);
  }, []);
  const handleMouseDown = useCallback(() => engineRef.current.handleBoost(true), []);
  const handleMouseUp = useCallback(() => engineRef.current.handleBoost(false), []);
  const toggleGame = () => setIsRunning(!isRunning);
  const resetGame = () => {
    setIsRunning(false);
    engineRef.current.reset();
    setScore(0);
    setGameOver(false);
  };

  return (
    <div className="w-screen h-screen bg-gray-900 text-white font-sans relative overflow-hidden">
      <canvas
        ref={canvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="block absolute top-0 left-0"
      />
      
      {/* MODIFIED: Increased z-index for UI Overlays to be on top of the start/game-over screen */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-4 z-30">
        <h1 className="text-3xl font-bold text-green-400 whitespace-nowrap hidden sm:block">Slither.io Clone</h1>
        <div className="flex gap-2">
            <button onClick={toggleGame} className="flex items-center gap-2 px-4 py-2 bg-green-800/80 hover:bg-green-700/80 rounded-lg transition-colors backdrop-blur-sm border border-green-600/50">
                {isRunning ? <Pause size={20} /> : <Play size={20} />}
                {isRunning ? 'Pause' : 'Play'}
            </button>
            <button onClick={resetGame} className="flex items-center gap-2 px-4 py-2 bg-red-800/80 hover:bg-red-700/80 rounded-lg transition-colors backdrop-blur-sm border border-red-600/50">
                <RotateCcw size={20} /> Reset
            </button>
        </div>
      </div>
      
      <div className="absolute top-4 right-4 z-30 bg-gray-800/70 p-3 rounded-lg w-64 backdrop-blur-sm border border-gray-600/50">
        <div className="flex items-center gap-2 mb-2">
            <Trophy size={20} className="text-yellow-400" />
            <span className="font-bold">Leaderboard</span>
        </div>
        {leaderboard.map((entry, i) => (
            <div key={i} className={`flex justify-between py-1 text-sm ${entry.isPlayer ? 'text-green-400 font-bold' : 'text-gray-300'}`}>
                <span>{i + 1}. {entry.name}</span>
                <span>{entry.score}</span>
            </div>
        ))}
      </div>

      <div className="absolute bottom-4 left-4 z-30 bg-gray-800/70 p-3 rounded-lg backdrop-blur-sm border border-gray-600/50">
        <div className="text-sm text-gray-300">Score: <span className="font-bold text-white">{score}</span></div>
        <div className="text-sm text-gray-300">Rank: <span className="font-bold text-white">{playerRank.rank} / {playerRank.total}</span></div>
      </div>
      
       {/* Mini-map is drawn on canvas, but we can have an icon */}
      <div className="absolute bottom-4 right-4 z-30 flex items-center gap-2 bg-gray-800/70 p-2 rounded-full backdrop-blur-sm border border-gray-600/50 pointer-events-none">
        <Map size={20} className="text-gray-300"/>
      </div>


      {!isRunning && (
         <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-20">
           <div className="text-center p-8 rounded-lg bg-gray-800/80 backdrop-blur-md border border-gray-600/50">
             {gameOver ? (
                <>
                    <div className="text-4xl font-bold text-red-400 mb-2">Game Over!</div>
                    <div className="text-2xl text-red-300">Final Score: {score}</div>
                </>
             ) : (
                <>
                    <div className="text-3xl font-bold mb-2">Ready to Play?</div>
                    <div className="text-gray-300">Move mouse to control, hold to boost.</div>
                </>
             )}
           </div>
         </div>
       )}
    </div>
  );
};

export default SlitherIOGame;
