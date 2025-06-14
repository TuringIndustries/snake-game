import { React, useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, RotateCcw, Trophy, Map } from 'lucide-react';

// Game constants
const CONFIG = {
  // USER-PROVIDED CONSTANTS
  WORLD_W: 3000,
  WORLD_H: 3000,
  SNAKE_SPEED: 2.5, BOOST_SPEED: 4.5, TURN_SPEED: 0.1,

  MIN_SNAKE_WIDTH: 15,
  MAX_SNAKE_WIDTH: 75,
  SCORE_FOR_MAX_WIDTH: 2000,
  
  SCORE_TO_LENGTH_RATIO: 3, 
  INITIAL_LENGTH: 50, 

  MAX_TURN_RATE: 0.15,
  MIN_TURN_RATE: 0.05,
  SCORE_FOR_MIN_TURN_RATE: 1500,

  FOOD_COUNT: 300, 
  AI_COUNT: 20,
  
  MIN_ZOOM: 2.3,
  MAX_ZOOM: 0.1,
  SCORE_FOR_MAX_ZOOM: 2000,

  COLORS: {
    BG: '#0D1117', 
    GRID: 'rgba(255, 255, 255, 0.05)', 
    PLAYER: ['#00ff88', '#00dd77'],
    AI: ['#ff4444', '#dd4444', '#4444ff', '#4444dd', '#ffaa00', '#dd8800'],
    FOOD: ['#ffff00', '#ff8800', '#ff0088', '#8800ff'],
    FOOD_MEDIUM: '#ff44ff',
    FOOD_LARGE: '#44ffff',
    POWER_FOOD: '#ff0000',
    MINIMAP_BG: 'rgba(13, 17, 23, 0.7)',
    MINIMAP_BORDER: '#30363d',
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
  constructor(x, y, options = {}) {
    super(x, y);
    this.type = options.type || 'normal';
    this.value = options.value || 1;
    this.size = options.size || 3 + Math.random() * 2;
    this.color = options.color || CONFIG.COLORS.FOOD[Math.floor(Math.random() * CONFIG.COLORS.FOOD.length)];
    
    this.pulse = Math.random() * Math.PI * 2;
    this.sparkles = null;
    this.life = null;

    if (this.type === 'power') {
      this.sparkles = [];
      for (let i = 0; i < 6; i++) {
        this.sparkles.push({
          angle: (i / 6) * Math.PI * 2,
          distance: 0,
          phase: Math.random() * Math.PI * 2
        });
      }
    } else if (this.type === 'death') {
        this.life = 30 * 60;
    }
  }

  update(dt) {
    this.pulse += 0.1 * dt;
    if (this.sparkles) {
      this.sparkles.forEach(sparkle => {
        sparkle.phase += 0.2 * dt;
        sparkle.distance = 15 + Math.sin(sparkle.phase) * 5;
      });
    }
    if (this.life !== null) {
      this.life -= dt;
    }
  }

  getSize() {
    let baseSize = this.size;
    let pulseAmount = this.type === 'death' ? baseSize * 0.25 : 1;
    return baseSize + Math.sin(this.pulse) * pulseAmount;
  }
}

class Snake extends GameObject {
  constructor(x, y, isPlayer = false) {
    super(x, y);
    this.path = [{ x, y, angle: 0 }];
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
      CONFIG.COLORS.AI.slice(Math.floor(Math.random() * CONFIG.COLORS.AI.length / 2) * 2, Math.floor(Math.random() * CONFIG.COLORS.AI.length / 2) * 2 + 2);
    
    this.aiTarget = null;
    this.aiTimer = 0;
  }

  getWidth() {
    const growthProgress = Math.min(1, Math.sqrt(this.score / CONFIG.SCORE_FOR_MAX_WIDTH));
    return lerp(CONFIG.MIN_SNAKE_WIDTH, CONFIG.MAX_SNAKE_WIDTH, growthProgress);
  }
  
  getLength() {
    return CONFIG.INITIAL_LENGTH + this.score * CONFIG.SCORE_TO_LENGTH_RATIO;
  }
  
  // FIX: This function is now much more precise to prevent length flickering.
  prunePath() {
    const targetLength = this.getLength();
    let currentPathLength = 0;
    
    for (let i = 0; i < this.path.length - 1; i++) {
        const p1 = this.path[i];
        const p2 = this.path[i+1];
        const segmentLength = dist(p1.x, p1.y, p2.x, p2.y);
        
        if (currentPathLength + segmentLength > targetLength) {
            // The tail should end somewhere on this segment.
            const overhang = (currentPathLength + segmentLength) - targetLength;
            const ratio = (segmentLength - overhang) / segmentLength;
            
            // Create a new tail-end point at the exact correct position.
            const newTailPoint = {
                x: lerp(p1.x, p2.x, ratio),
                y: lerp(p1.y, p2.y, ratio),
                angle: p2.angle,
            };
            
            // Cut the path array and add the new precise tail point.
            this.path.splice(i + 1);
            this.path.push(newTailPoint);
            return; // Exit the function
        }
        currentPathLength += segmentLength;
    }
  }


  update(dt, gameState) {
    if (!this.isAlive) return;

    this.aiTimer += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.magnetism = Math.max(0, this.magnetism - dt);

    if (!this.isPlayer) this.updateAI(gameState);

    const turnProgress = Math.min(1, this.score / CONFIG.SCORE_FOR_MIN_TURN_RATE);
    const turnRate = lerp(CONFIG.MAX_TURN_RATE, CONFIG.MIN_TURN_RATE, turnProgress);

    let angleDiff = this.targetAngle - this.angle;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    const maxTurn = turnRate * dt;
    angleDiff = clamp(angleDiff, -maxTurn, maxTurn);
    this.angle += angleDiff;

    const head = this.path[0];
    const newHeadX = head.x + Math.cos(this.angle) * this.speed * dt;
    const newHeadY = head.y + Math.sin(this.angle) * this.speed * dt;
    
    this.path.unshift({ x: newHeadX, y: newHeadY, angle: this.angle });

    this.prunePath();

    if (this.magnetism > 0 && this.isPlayer) {
      gameState.food.forEach(food => {
        const d = dist(head.x, head.y, food.x, food.y);
        const magnetRadius = 150 + this.getWidth() * 2;
        if (d < magnetRadius) {
          const pullForce = (magnetRadius - d) / magnetRadius * 3 * dt;
          const pullAngle = angle(food.x, food.y, head.x, head.y);
          food.x += Math.cos(pullAngle) * pullForce;
          food.y += Math.sin(pullAngle) * pullForce;
        }
      });
    }

    if (this.speed > CONFIG.SNAKE_SPEED && this.boost > 0) {
      this.boost -= 0.5 * dt;
    } else if (this.boost < 100) {
      this.boost += 0.2 * dt;
    }
    this.boost = clamp(this.boost, 0, 100);
  }

  updateAI(gameState) {
    const head = this.path[0];
    const visionRange = 300;
    const nearFood = gameState.food.filter(f => dist(head.x, head.y, f.x, f.y) < visionRange);
    const nearSnakes = gameState.snakes.filter(s =>
      s.id !== this.id && s.isAlive && dist(head.x, head.y, s.path[0].x, s.path[0].y) < visionRange
    );

    if (nearSnakes.length > 0) {
      const nearest = nearSnakes[0];
      const avoidAngle = angle(nearest.path[0].x, nearest.path[0].y, head.x, head.y);
      this.targetAngle = avoidAngle;
      this.speed = CONFIG.BOOST_SPEED;
    } else if (nearFood.length > 0) {
      const nearest = nearFood.reduce((closest, food) =>
        (food.value / dist(head.x, head.y, food.x, food.y)) > (closest.value / dist(head.x, head.y, closest.x, closest.y)) ? food : closest
      );
      this.targetAngle = angle(head.x, head.y, nearest.x, nearest.y);
      this.speed = CONFIG.SNAKE_SPEED;
    } else if (this.aiTimer > 5 * 60 || !this.aiTarget) {
      this.targetAngle = this.angle + (Math.random() - 0.5) * Math.PI / 2;
      this.aiTimer = 0;
      this.speed = CONFIG.SNAKE_SPEED;
    }
  }

  checkCollision(other) {
    if (!this.isAlive || !other.isAlive || this.id === other.id || this.invulnerable > 0) return false;
    const head = this.path[0];
    const headRadius = this.getWidth() / 2;

    for(let i = 1; i < other.path.length; i++) {
        const seg = other.path[i];
        const segRadius = other.getWidth() / 2;
        if (dist(head.x, head.y, seg.x, seg.y) < headRadius + segRadius) {
            return true;
        }
    }
    return false;
  }

  grow(amount = 1) {
    this.score += amount;
  }

  activatePower(type) {
    const ticksPerSecond = 60;
    switch (type) {
      case 'invulnerable': this.invulnerable = 10 * ticksPerSecond; break;
      case 'magnetism': this.magnetism = 15 * ticksPerSecond; break;
      case 'speed': this.boost = 100; break;
      default: break;
    }
  }

  setTarget(worldX, worldY) {
    if (!this.isPlayer) return;
    const head = this.path[0];
    this.targetAngle = angle(head.x, head.y, worldX, worldY);
  }

  setBoost(boosting) {
    if (!this.isPlayer) return;
    this.speed = boosting && this.boost > 0 ? CONFIG.BOOST_SPEED : CONFIG.SNAKE_SPEED;
  }

  checkFood(food) {
    if (!this.isAlive) return false;
    const head = this.path[0];

    const headRadius = this.getWidth() / 2;
    const foodRadius = food.getSize();
    return dist(head.x, head.y, food.x, food.y) < headRadius + foodRadius;
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
    this.camera = { x: 0, y: 0, zoom: CONFIG.MIN_ZOOM };
    this.running = false;
    this.score = 0;
    this.canvasWidth = 800;
    this.canvasHeight = 600;
    this.lastTime = 0;
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
      this.spawnRandomFood();
    }
    
    for (let i = 0; i < Math.floor(CONFIG.FOOD_COUNT * 0.05); i++) {
        this.food.push(new Food(Math.random() * CONFIG.WORLD_W, Math.random() * CONFIG.WORLD_H, {
            type: 'power',
            value: 10,
            size: 8,
            color: CONFIG.COLORS.POWER_FOOD,
        }));
    }

    this.camera.zoom = CONFIG.MIN_ZOOM;
    this.camera.x = this.player.path[0].x;
    this.camera.y = this.player.path[0].y;
  }
  
  spawnRandomFood() {
    const x = Math.random() * CONFIG.WORLD_W;
    const y = Math.random() * CONFIG.WORLD_H;
    const rand = Math.random();
    let options;

    if (rand < 0.01) {
        options = { value: 10, size: 10, color: CONFIG.COLORS.FOOD_LARGE };
    } else if (rand < 0.06) {
        options = { value: 5, size: 6, color: CONFIG.COLORS.FOOD_MEDIUM };
    } else {
        options = { value: 1, size: 3 + Math.random() * 2 };
    }
    this.food.push(new Food(x, y, options));
  }

  update(time) {
    if (this.lastTime === 0) { // Initial frame setup
      this.lastTime = time;
      return;
    };
    const dtSeconds = (time - this.lastTime) / 1000;
    this.lastTime = time;
    
    const clampedDt = Math.min(dtSeconds, 0.1); 
    const gameTick = clampedDt * 60;

    this.snakes.forEach(snake => {
      if(snake.isAlive) snake.update(gameTick, { snakes: this.snakes, food: this.food })
    });

    const newlyDeadSnakes = [];
    this.snakes.forEach(snake => {
      if (!snake.isAlive) return;
      const head = snake.path[0];
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
        const totalValue = Math.floor(deadSnake.score * 0.75);
        let remainingValue = totalValue;

        deadSnake.path.forEach((point, index) => {
            if (remainingValue <= 0) return;
            
            if (index > 0 && index % 5 === 0) {
                const value = Math.min(remainingValue, Math.floor(Math.random() * 8) + 5);
                remainingValue -= value;

                const foodOptions = {
                    type: 'death', value: value, size: 4 + value * 0.6,
                    color: deadSnake.colors[index % deadSnake.colors.length]
                };
                
                const ejectAngle = point.angle + (Math.random() - 0.5) * Math.PI;
                const ejectDist = Math.random() * deadSnake.getWidth();
                const x = point.x + Math.cos(ejectAngle) * ejectDist;
                const y = point.y + Math.sin(ejectAngle) * ejectDist;
                
                this.food.push(new Food(x, y, foodOptions));
            }
        });
    });

    for (let i = this.food.length - 1; i >= 0; i--) {
        const food = this.food[i];
        food.update(gameTick);

        if (food.life !== null && food.life <= 0) {
            this.food.splice(i, 1);
            continue;
        }
    }

    this.snakes.forEach(snake => {
      if (!snake.isAlive) return;
      for (let i = this.food.length - 1; i >= 0; i--) {
        const food = this.food[i];
        if (snake.checkFood(food)) {
          snake.grow(food.value);
          this.food.splice(i, 1);
          
          if(food.type !== 'death' && food.type !== 'power') {
              this.spawnRandomFood();
          } else if (food.type === 'power') {
             const powers = ['invulnerable', 'magnetism', 'speed'];
             snake.activatePower(powers[Math.floor(Math.random() * powers.length)]);
             this.food.push(new Food(Math.random() * CONFIG.WORLD_W, Math.random() * CONFIG.WORLD_H, { type: 'power', value: 10, size: 8, color: CONFIG.COLORS.POWER_FOOD }));
          }
        }
      }
    });

    if (this.player.isAlive) {
      const head = this.player.path[0];
      this.camera.x = lerp(this.camera.x, head.x, 0.1);
      this.camera.y = lerp(this.camera.y, head.y, 0.1);

      const zoomProgress = Math.min(1, Math.sqrt(this.player.score / CONFIG.SCORE_FOR_MAX_ZOOM));
      const targetZoom = lerp(CONFIG.MIN_ZOOM, CONFIG.MAX_ZOOM, zoomProgress);
      this.camera.zoom = lerp(this.camera.zoom, targetZoom, 0.05);

      this.score = this.player.score;
    }

    const aliveAI = this.snakes.filter(s => !s.isPlayer && s.isAlive).length;
    if (aliveAI < CONFIG.AI_COUNT) {
      this.snakes.push(new Snake(Math.random() * CONFIG.WORLD_W, Math.random() * CONFIG.WORLD_H));
    }
  }

  render(ctx, width, height) {
    ctx.save();
    
    ctx.fillStyle = CONFIG.COLORS.BG;
    ctx.fillRect(0, 0, width, height);

    ctx.translate(width / 2, height / 2);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    const view = {
        left: this.camera.x - (width / 2) / this.camera.zoom,
        right: this.camera.x + (width / 2) / this.camera.zoom,
        top: this.camera.y - (height / 2) / this.camera.zoom,
        bottom: this.camera.y + (height / 2) / this.camera.zoom
    };

    ctx.strokeStyle = CONFIG.COLORS.GRID;
    ctx.lineWidth = 1 / this.camera.zoom;
    const gridSize = 50;
    const startX = Math.floor(view.left / gridSize) * gridSize;
    const startY = Math.floor(view.top / gridSize) * gridSize;

    for (let x = startX; x < view.right; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, view.top);
      ctx.lineTo(x, view.bottom);
      ctx.stroke();
    }
    for (let y = startY; y < view.bottom; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(view.left, y);
      ctx.lineTo(view.right, y);
      ctx.stroke();
    }
    
    this.food.forEach(food => {
      if (food.x > view.left - 20 && food.x < view.right + 20 && food.y > view.top - 20 && food.y < view.bottom + 20) {
        if (food.sparkles) {
          ctx.fillStyle = '#ffffff';
          food.sparkles.forEach(sparkle => {
            const sparkleX = food.x + Math.cos(sparkle.angle) * sparkle.distance;
            const sparkleY = food.y + Math.sin(sparkle.angle) * sparkle.distance;
            ctx.beginPath();
            ctx.arc(sparkleX, sparkleY, 1, 0, Math.PI * 2);
            ctx.fill();
          });
        }
        
        ctx.fillStyle = food.color;
        ctx.shadowColor = food.color;
        
        if (food.type === 'death') {
            ctx.shadowBlur = 15 + Math.sin(food.pulse * 2) * 7;
        } else if (food.type === 'power') {
            ctx.shadowBlur = 12;
        } else {
            ctx.shadowBlur = food.size > 8 ? 10 : 5;
        }
        
        ctx.beginPath();
        ctx.arc(food.x, food.y, food.getSize(), 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });
    
    this.snakes.forEach(snake => {
        if (!snake.isAlive || snake.path.length < 2) return;

        const snakeWidth = snake.getWidth();

        ctx.strokeStyle = snake.colors[1];
        ctx.lineWidth = snakeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        if (snake.speed > CONFIG.SNAKE_SPEED) {
            ctx.shadowColor = snake.colors[0];
            ctx.shadowBlur = 25;
        }
        
        ctx.beginPath();
        ctx.moveTo(snake.path[0].x, snake.path[0].y);
        for (let i = 1; i < snake.path.length; i++) {
            ctx.lineTo(snake.path[i].x, snake.path[i].y);
        }
        ctx.stroke();

        ctx.strokeStyle = snake.colors[0];
        ctx.lineWidth = snakeWidth * 0.7;
        ctx.shadowBlur = 0;
        ctx.stroke();
        
        const head = snake.path[0];
        const radius = snakeWidth / 2;
        ctx.fillStyle = '#fff';
        const eyeRadius = radius * 0.2;
        const eyeOffset = radius * 0.5;
        ctx.beginPath();
        ctx.arc(head.x + Math.cos(head.angle - 0.5) * eyeOffset, head.y + Math.sin(head.angle - 0.5) * eyeOffset, eyeRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(head.x + Math.cos(head.angle + 0.5) * eyeOffset, head.y + Math.sin(head.angle + 0.5) * eyeOffset, eyeRadius, 0, Math.PI * 2);
        ctx.fill();
    });

    const pulse = 128 + Math.sin(Date.now() * 0.0085) * 64;
    ctx.strokeStyle = `rgba(255, ${pulse}, 0, 0.7)`;
    ctx.lineWidth = 10 / this.camera.zoom;
    ctx.strokeRect(0, 0, CONFIG.WORLD_W, CONFIG.WORLD_H);

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
    ctx.globalAlpha = 0.8;
    ctx.fillRect(mapX, mapY, mapW, mapH);
    ctx.strokeRect(mapX, mapY, mapW, mapH);
    ctx.globalAlpha = 1;
    
    this.snakes.forEach(snake => {
        if (!snake.isAlive) return;
        const head = snake.path[0];
        const dotX = mapX + head.x * scaleX;
        const dotY = mapY + head.y * scaleY;
        ctx.fillStyle = snake.isPlayer ? CONFIG.COLORS.PLAYER[0] : snake.colors[0];
        ctx.beginPath();
        ctx.arc(dotX, dotY, snake.isPlayer ? 3 : 2, 0, Math.PI * 2);
        ctx.fill();
    });

    const camRectX = mapX + (this.camera.x - (this.canvasWidth / 2) / this.camera.zoom) * scaleX;
    const camRectY = mapY + (this.camera.y - (this.canvasHeight / 2) / this.camera.zoom) * scaleY;
    const camRectW = (this.canvasWidth / this.camera.zoom) * scaleX;
    const camRectH = (this.canvasHeight / this.camera.zoom) * scaleY;
    ctx.strokeStyle = CONFIG.COLORS.MINIMAP_CAMERA;
    ctx.lineWidth = 1;
    ctx.strokeRect(camRectX, camRectY, camRectW, camRectH);

    ctx.restore();
  }

  start() { this.running = true; this.lastTime = 0; }
  pause() { this.running = false; }
  reset() { this.running = false; this.score = 0; this.init(); }
  
  handleMouse(x, y) {
      if (!this.player || !this.player.isAlive) return;
      const worldX = (x - this.canvasWidth / 2) / this.camera.zoom + this.camera.x;
      const worldY = (y - this.canvasHeight / 2) / this.camera.zoom + this.camera.y;
      this.player.setTarget(worldX, worldY);
  }

  handleBoost(boosting) { if (this.player && this.player.isAlive) this.player.setBoost(boosting); }
  isGameOver() { return !this.player || !this.player.isAlive; }

  getLeaderboard() {
    if (!this.snakes) return [];
    return this.snakes.filter(s => s.isAlive).sort((a, b) => b.score - a.score).slice(0, 10).map((s, i) => ({
      name: s.isPlayer ? 'You' : `AI Bot`, score: s.score, isPlayer: s.isPlayer
    }));
  }

  getPlayerRank() {
    if (!this.snakes) return { rank: 0, total: 0 };
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
  const engineRef = useRef(null);
  const animationRef = useRef();
  
  const [gameStatus, setGameStatus] = useState('menu');
  const [score, setScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [playerRank, setPlayerRank] = useState({ rank: 0, total: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    engineRef.current = new GameEngine();
    handleResize();
    animationRef.current = requestAnimationFrame(gameLoop);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  const gameLoop = useCallback((time) => {
    const engine = engineRef.current;
    const canvas = canvasRef.current;
    if (!engine || !canvas) {
        animationRef.current = requestAnimationFrame(gameLoop);
        return;
    };

    const ctx = canvas.getContext('2d');
    
    if (engine.running) {
      engine.update(time);

      if (engine.isGameOver()) {
        engine.pause();
        setGameStatus('gameover');
      }
    }

    engine.render(ctx, canvas.width, canvas.height);
    
    setScore(engine.score);
    if (time % 100 < 17) {
        setLeaderboard(engine.getLeaderboard());
        setPlayerRank(engine.getPlayerRank());
    }

    animationRef.current = requestAnimationFrame(gameLoop);
  }, []);

  const handleResize = () => {
    const newSize = { width: window.innerWidth, height: window.innerHeight };
    setCanvasSize(newSize);
    if(engineRef.current) {
        engineRef.current.setCanvasSize(newSize.width, newSize.height);
    }
  };

  useEffect(() => {
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleMouseMove = useCallback((e) => {
    engineRef.current?.handleMouse(e.clientX, e.clientY);
  }, []);
  const handleMouseDown = useCallback(() => {
    if (gameStatus === 'playing') engineRef.current?.handleBoost(true);
  }, [gameStatus]);
  const handleMouseUp = useCallback(() => {
    if (gameStatus === 'playing') engineRef.current?.handleBoost(false);
  }, [gameStatus]);

  const togglePause = () => {
    if (gameStatus === 'playing') {
      engineRef.current.pause();
      setGameStatus('paused');
    } else if (gameStatus === 'paused') {
      engineRef.current.start();
      setGameStatus('playing');
    }
  };
  
  const startGame = () => {
    engineRef.current.reset();
    engineRef.current.start();
    setGameStatus('playing');
  };
  
  const isOverlayVisible = gameStatus === 'menu' || gameStatus === 'gameover' || gameStatus === 'paused';

  return (
    <div className="w-screen h-screen bg-gray-900 text-white font-sans relative overflow-hidden select-none">
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
      
      {gameStatus === 'playing' || gameStatus === 'paused' ? (
        <>
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-4 z-10">
            <h1 className="text-3xl font-bold text-green-400 whitespace-nowrap hidden sm:block" style={{textShadow: '0 0 10px #00ff88'}}>Slither.io</h1>
            <div className="flex gap-2">
                <button onClick={togglePause} className="flex items-center gap-2 px-4 py-2 bg-green-800/80 hover:bg-green-700/80 rounded-lg transition-colors backdrop-blur-sm border border-green-600/50">
                    {gameStatus === 'paused' ? <Play size={20} /> : <Pause size={20} />}
                    {gameStatus === 'paused' ? 'Resume' : 'Pause'}
                </button>
                <button onClick={startGame} className="flex items-center gap-2 px-4 py-2 bg-red-800/80 hover:bg-red-700/80 rounded-lg transition-colors backdrop-blur-sm border border-red-600/50">
                    <RotateCcw size={20} /> Reset
                </button>
            </div>
          </div>
          
          <div className="absolute top-4 right-4 z-10 bg-gray-900/70 p-3 rounded-lg w-64 backdrop-blur-sm border border-gray-700/50">
            <div className="flex items-center gap-2 mb-2"> <Trophy size={20} className="text-yellow-400" /> <span className="font-bold">Leaderboard</span> </div>
            {leaderboard.map((entry, i) => (
                <div key={i} className={`flex justify-between py-1 text-sm ${entry.isPlayer ? 'text-green-300 font-bold' : 'text-gray-300'}`}>
                    <span>{i + 1}. {entry.name}</span>
                    <span>{entry.score}</span>
                </div>
            ))}
          </div>

          <div className="absolute bottom-4 left-4 z-10 bg-gray-900/70 p-3 rounded-lg backdrop-blur-sm border border-gray-700/50">
            <div className="text-sm text-gray-300">Score: <span className="font-bold text-white">{score}</span></div>
            <div className="text-sm text-gray-300">Rank: <span className="font-bold text-white">{playerRank.rank} / {playerRank.total}</span></div>
            <div className="text-sm text-gray-300">Boost: <span className="font-bold text-white">{engineRef.current?.player?.boost.toFixed(0) || 100}%</span></div>
          </div>
          
          <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2 bg-gray-900/70 p-2 rounded-full backdrop-blur-sm border border-gray-700/50 pointer-events-none">
            <Map size={20} className="text-gray-300"/>
          </div>
        </>
      ) : null}

      {isOverlayVisible && (
         <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-20 backdrop-blur-sm">
           <div className="text-center p-8 rounded-lg bg-gray-800/90 border border-gray-600/50 shadow-2xl">
             {gameStatus === 'gameover' ? (
                <>
                    <h2 className="text-5xl font-bold text-red-500 mb-2">Game Over!</h2>
                    <p className="text-2xl text-red-300 mb-6">Final Score: {score}</p>
                    <button onClick={startGame} className="px-8 py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg text-xl transition-transform transform hover:scale-105">
                        Play Again
                    </button>
                </>
             ) : gameStatus === 'menu' ? (
                <>
                    <h2 className="text-5xl font-bold mb-4 text-green-400">Slither.io</h2>
                    <p className="text-gray-300 mb-6">Move your mouse to control the snake.<br/>Click and hold to boost.</p>
                     <button onClick={startGame} className="px-8 py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg text-xl transition-transform transform hover:scale-105">
                        Start Game
                    </button>
                </>
             ) : ( // Paused
                <>
                    <h2 className="text-5xl font-bold mb-4 text-yellow-400">Paused</h2>
                    <button onClick={togglePause} className="px-8 py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg text-xl transition-transform transform hover:scale-105">
                        Resume
                    </button>
                </>
             )}
           </div>
         </div>
       )}
    </div>
  );
};

export default SlitherIOGame;
