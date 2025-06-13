import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, RotateCcw, Trophy } from 'lucide-react';

// Game constants
const CONFIG = {
  CANVAS_W: 800, CANVAS_H: 600, WORLD_W: 1600, WORLD_H: 1200,
  SNAKE_SPEED: 2, BOOST_SPEED: 4, TURN_SPEED: 0.1, 
  
  // NEW: Centralized growth parameters for easy tuning
  MIN_SNAKE_WIDTH: 10, 
  MAX_SNAKE_WIDTH: 35, 
  SCORE_FOR_MAX_WIDTH: 2000, // Score needed to reach max width. Higher = slower width growth.

  MIN_SNAKE_LENGTH: 10,
  MAX_SNAKE_LENGTH: 100,
  SCORE_FOR_MAX_LENGTH: 2000, // Score needed to reach max length. Higher = slower length growth.

  MIN_TURN_RADIUS:2, MAX_TURN_RADIUS: 15,
  FOOD_COUNT: 150, AI_COUNT: 5, COLORS: {
    BG: '#000000', GRID: '#87CEFA',
    PLAYER: ['#00ff88', '#00dd77', '#00bb66'],
    AI: ['#ff4444', '#4444ff', '#ffaa00', '#ff44ff', '#44ffff'],
    FOOD: ['#ffff00', '#ff8800', '#ff0088', '#8800ff'],
    POWER_FOOD: '#ff0000',
  }
};

// Utility functions
const dist = (x1, y1, x2, y2) => Math.sqrt((x2-x1)**2 + (y2-y1)**2);
const angle = (x1, y1, x2, y2) => Math.atan2(y2-y1, x2-x1);
const lerp = (a, b, t) => a + (b-a) * t;
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
    this.segments = [{x, y, angle: 0}];
    this.angle = Math.random() * Math.PI * 2;
    this.targetAngle = this.angle;
    this.speed = CONFIG.SNAKE_SPEED;
    // REMOVED: `this.length` is no longer a stored property. It's calculated dynamically.
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
    
    // MODIFIED: Initialize with the minimum number of segments from CONFIG.
    for (let i = 1; i < CONFIG.MIN_SNAKE_LENGTH; i++) {
      const prev = this.segments[i-1];
      const desiredDist = this.getWidth() * 0.7;
      this.segments.push({
        x: prev.x - Math.cos(this.angle) * desiredDist,
        y: prev.y - Math.sin(this.angle) * desiredDist,
        angle: this.angle
      });
    }
  }
  
  /**
   * UPDATED: Calculates the snake's width based on score. Tunable via CONFIG.
   */
  getWidth() {
    const growthProgress = Math.min(1, Math.sqrt(this.score / CONFIG.SCORE_FOR_MAX_WIDTH));
    return lerp(CONFIG.MIN_SNAKE_WIDTH, CONFIG.MAX_SNAKE_WIDTH, growthProgress);
  }
  
  /**
   * NEW: Calculates the snake's target length based on score. Tunable via CONFIG.
   */
  getLength() {
    const growthProgress = Math.min(1, Math.sqrt(this.score / CONFIG.SCORE_FOR_MAX_LENGTH));
    // Use Math.floor to ensure the result is an integer for the segment count.
    return Math.floor(lerp(CONFIG.MIN_SNAKE_LENGTH, CONFIG.MAX_SNAKE_LENGTH, growthProgress));
  }

  update(dt, gameState) {
    if (!this.isAlive) return;
    
    this.aiTimer += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.magnetism = Math.max(0, this.magnetism - dt);
    
    if (!this.isPlayer) this.updateAI(gameState);
    
    // MODIFIED: Turn radius now based on the actual number of segments.
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

    // Food magnetism effect
    if (this.magnetism > 0 && this.isPlayer) {
      gameState.food.forEach(food => {
        const d = dist(head.x, head.y, food.x, food.y);
        if (d < 150) {
          const pullForce = (2000- d) /1000 * 2;
          const pullAngle = angle(food.x, food.y, head.x, head.y);
          food.x += Math.cos(pullAngle) * pullForce;
          food.y += Math.sin(pullAngle) * pullForce;
        }
      });
    }
    
    // Segment following logic now based on dynamic width for a solid appearance.
    for (let i = 1; i < this.segments.length; i++) {
      const curr = this.segments[i];
      const prev = this.segments[i-1];
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
    
    // MODIFIED: Continuously add segments if the current count is less than the calculated target length.
    while (this.segments.length < this.getLength()) {
      const last = this.segments[this.segments.length - 1];
      const desiredDist = this.getWidth() * 0.7;
      this.segments.push({
        x: last.x - Math.cos(last.angle) * desiredDist,
        y: last.y - Math.sin(last.angle) * desiredDist,
        angle: last.angle
      });
    }
    
    // Update boost
    if (this.speed > CONFIG.SNAKE_SPEED && this.boost > 0) {
      this.boost -= 0.5 * dt;
    } else if (this.boost < 100) {
      this.boost += 0.2 * dt;
    }
    this.boost = clamp(this.boost, 0, 100);
  }
  
  updateAI(gameState) {
    const head = this.segments[0];
    const nearFood = gameState.food.filter(f => dist(head.x, head.y, f.x, f.y) < 100);
    const nearSnakes = gameState.snakes.filter(s => 
      s.id !== this.id && s.isAlive && dist(head.x, head.y, s.segments[0].x, s.segments[0].y) < 80
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

    return other.segments.slice(1).some(seg => {
      const segRadius = other.getWidth() / 2;
      return dist(head.x, head.y, seg.x, seg.y) < headRadius + segRadius;
    });
  }
  
  /**
   * UPDATED: Growth is now decoupled. Eating food only increases the score.
   * The actual growth of length and width is handled by the getLength() and getWidth() methods.
   */
  grow(amount = 1) {
    this.score += amount;
  }
  
  activatePower(type) {
    switch(type) {
      case 'invulnerable': this.invulnerable = 200; break;
      case 'magnetism': this.magnetism = 300; break;
      case 'speed': this.boost = 100; break;
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
    this.camera = {x: 0, y: 0};
    this.running = false;
    this.score = 0;
    this.init();
  }
  
  init() {
    this.snakes = [];
    this.food = [];
    this.mousePos = {x: 400, y: 300};
  
    this.player = new Snake(CONFIG.WORLD_W/2, CONFIG.WORLD_H/2, true);
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
    
    this.snakes.forEach(snake => snake.update(dt, {snakes: this.snakes, food: this.food}));
    
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
          // The grow method now only passes the food's value to increase the score.
          snake.grow(food.value); 
          if (food.type === 'power') {
            const powers = ['invulnerable', 'magnetism', 'speed'];
            snake.activatePower(powers[Math.floor(Math.random() * powers.length)]);
            this.food.splice(i, 1, new Food(
              Math.random() * CONFIG.WORLD_W, 
              Math.random() * CONFIG.WORLD_H,
              Math.random() < 0.2 ? 'power' : 'normal'
            ));
          } else {
            this.food.splice(i, 1, new Food(Math.random() * CONFIG.WORLD_W, Math.random() * CONFIG.WORLD_H));
          }
        }
      }
    });
    
    this.food.forEach(food => food.update());
    
    if (this.player.isAlive) {
      const head = this.player.segments[0];
      this.camera.x = lerp(this.camera.x, head.x - CONFIG.CANVAS_W/2, 0.1);
      this.camera.y = lerp(this.camera.y, head.y - CONFIG.CANVAS_H/2, 0.1);
      this.score = this.player.score;
    }
    
    const aliveAI = this.snakes.filter(s => !s.isPlayer && s.isAlive).length;
    if (aliveAI < CONFIG.AI_COUNT) {
      this.snakes.push(new Snake(Math.random() * CONFIG.WORLD_W, Math.random() * CONFIG.WORLD_H));
    }
  }
     
  render(ctx) {
    ctx.fillStyle = CONFIG.COLORS.BG;
    ctx.fillRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);
      
    ctx.strokeStyle = CONFIG.COLORS.GRID;
    ctx.lineWidth = 1;
    const gridSize = 50;
    const startX = Math.floor(this.camera.x / gridSize) * gridSize;
    const startY = Math.floor(this.camera.y / gridSize) * gridSize;
      
    for (let x = startX; x < this.camera.x + CONFIG.CANVAS_W; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x - this.camera.x, 0);
      ctx.lineTo(x - this.camera.x, CONFIG.CANVAS_H);
      ctx.stroke();
    }
      
    for (let y = startY; y < this.camera.y + CONFIG.CANVAS_H; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y - this.camera.y);
      ctx.lineTo(CONFIG.CANVAS_W, y - this.camera.y);
      ctx.stroke();
    }

    this.food.forEach(food => {
      const x = food.x - this.camera.x;
      const y = food.y - this.camera.y;
      if (x > -20 && x < CONFIG.CANVAS_W + 20 && y > -20 && y < CONFIG.CANVAS_H + 20) {
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

      const width = snake.getWidth();
      snake.segments.forEach((segment, i) => {
        const x = segment.x - this.camera.x;
        const y = segment.y - this.camera.y;

        if (x > -width && x < CONFIG.CANVAS_W + width && y > -width && y < CONFIG.CANVAS_H + width) {
          const radius = (i === 0 ? width * 1.2 : width) / 2;
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
            ctx.arc(x + Math.cos(segment.angle - 0.5) * eyeOffset,
                    y + Math.sin(segment.angle - 0.5) * eyeOffset, eyeRadius, 0, Math.PI * 2);
            ctx.arc(x + Math.cos(segment.angle + 0.5) * eyeOffset,
                    y + Math.sin(segment.angle + 0.5) * eyeOffset, eyeRadius, 0, Math.PI * 2);
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
  }

  start() { this.running = true; }
  pause() { this.running = false; }
  reset() { this.running = false; this.score = 0; this.init(); }
  
  handleMouse(x, y) {
    if (this.player.isAlive) this.player.setTarget(x, y, this.camera.x, this.camera.y);
  }
  
  handleBoost(boosting) {
    if (this.player.isAlive) this.player.setBoost(boosting);
  }
  
  isGameOver() { return !this.player.isAlive; }
  
  getLeaderboard() {
    return this.snakes
      .filter(s => s.isAlive)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((s, i) => ({
        name: s.isPlayer ? 'You' : `AI ${this.snakes.indexOf(s)}`,
        score: s.score,
        isPlayer: s.isPlayer
      }));
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
  
  const gameLoop = useCallback(() => {
    const engine = engineRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    
    if (ctx) {
      engine.update();
      engine.render(ctx);
      setScore(engine.score);
      setGameOver(engine.isGameOver());
      setLeaderboard(engine.getLeaderboard());
    }
    
    animationRef.current = requestAnimationFrame(gameLoop);
  }, []);
  
  useEffect(() => {
    if (isRunning) {
      engineRef.current.start();
      animationRef.current = requestAnimationFrame(gameLoop);
    } else {
      engineRef.current.pause();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    }
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isRunning, gameLoop]);
  
    const handleMouseMove = useCallback((e) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        engineRef.current.handleMouse(x, y);
      }
    }, []);
  
  const handleMouseDown = useCallback(() => {
    engineRef.current.handleBoost(true);
  }, []);
  
  const handleMouseUp = useCallback(() => {
    engineRef.current.handleBoost(false);
  }, []);
  
  const toggleGame = () => {
    setIsRunning(!isRunning);
  };
  
  const resetGame = () => {
    setIsRunning(false);
    engineRef.current.reset();
    setScore(0);
    setGameOver(false);
  };
  
  return (
    <div className="flex flex-col items-center min-h-screen bg-gray-900 text-white p-4">
      <div className="flex items-center gap-4 mb-4">
        <h1 className="text-3xl font-bold text-green-400">Slither.io</h1>
        <div className="flex gap-2">
          <button
            onClick={toggleGame}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
          >
            {isRunning ? <Pause size={20} /> : <Play size={20} />}
            {isRunning ? 'Pause' : 'Play'}
          </button>
          <button
            onClick={resetGame}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
          >
            <RotateCcw size={20} />
            Reset
          </button>
        </div>
      </div>
      
      <div className="flex gap-6 mb-4">
        <div className="bg-gray-800 px-4 py-2 rounded-lg">
          <div className="text-sm text-gray-400">Score</div>
          <div className="text-2xl font-bold text-green-400">{score}</div>
        </div>
        
        {gameOver && (
          <div className="bg-red-900 px-4 py-2 rounded-lg border border-red-600">
            <div className="text-lg font-bold text-red-400">Game Over!</div>
            <div className="text-sm text-red-300">Final Score: {score}</div>
          </div>
        )}
      </div>
      
      <div className="relative border-2 border-gray-700 rounded-lg overflow-hidden">
        <canvas
          ref={canvasRef}
          width={CONFIG.CANVAS_W}
          height={CONFIG.CANVAS_H}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          className="block cursor-none"
        />
        
        {!isRunning && !gameOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
            <div className="text-center">
              <div className="text-2xl font-bold mb-2">Ready to Play?</div>
              <div className="text-gray-300">Move mouse to control, hold to boost</div>
            </div>
          </div>
        )}
      </div>
      
      <div className="mt-4 bg-gray-800 rounded-lg p-4 min-w-64">
        <div className="flex items-center gap-2 mb-2">
          <Trophy size={20} className="text-yellow-400" />
          <span className="font-bold">Leaderboard</span>
        </div>
        {leaderboard.map((entry, i) => (
          <div key={i} className={`flex justify-between py-1 ${entry.isPlayer ? 'text-green-400 font-bold' : ''}`}>
            <span>{i + 1}. {entry.name}</span>
            <span>{entry.score}</span>
          </div>
        ))}
      </div>
      
      <div className="mt-4 text-center text-gray-400 text-sm">
        <div>Move your mouse to control the snake</div>
        <div>Hold mouse button to boost (uses energy)</div>
        <div>Eat food to grow • Avoid other snakes</div>
      </div>
    </div>
  );
};

export default SlitherIOGame;
