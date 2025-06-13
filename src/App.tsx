import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, RotateCcw, Trophy } from 'lucide-react';

// Game constants
const CONFIG = {
  CANVAS_W: 800, CANVAS_H: 600, WORLD_W: 1600, WORLD_H: 1200,
  SNAKE_SPEED: 2, BOOST_SPEED: 4, TURN_SPEED: 0.1, SEGMENT_SIZE: 10,
  MIN_TURN_RADIUS:2, MAX_TURN_RADIUS: 15, // New turning constraints
  FOOD_COUNT: 150, AI_COUNT: 5, COLORS: {
    BG: '#000000', GRID: '#87CEFA', // Changed to pure black
    PLAYER: ['#00ff88', '#00dd77', '#00bb66'],
    AI: ['#ff4444', '#4444ff', '#ffaa00', '#ff44ff', '#44ffff'],
    FOOD: ['#ffff00', '#ff8800', '#ff0088', '#8800ff'],
    POWER_FOOD: '#ff0000', // New power food
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
  /**
   * Creates a new Food object.
   * @param {number} x - The x-coordinate.
   * @param {number} y - The y-coordinate.
   * @param {string} [type='normal'] - The type of food ('normal' or 'power').
   * @param {string|null} [color=null] - An optional specific color for the food. If null, a random color is chosen.
   */
  constructor(x, y, type = 'normal', color = null) {
    super(x, y);
    this.type = type;
    this.size = type === 'power' ? 8 : 3 + Math.random() * 2;
    // MODIFIED: Use the provided color, or fall back to the default color logic.
    // This allows creating food from dead snakes with the snake's color.
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
    this.length = 5;
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
    
    for (let i = 1; i < this.length; i++) {
      this.segments.push({
        x: x - Math.cos(this.angle) * CONFIG.SEGMENT_SIZE * i,
        y: y - Math.sin(this.angle) * CONFIG.SEGMENT_SIZE * i,
        angle: this.angle
      });
    }
  }

  update(dt, gameState) {
    if (!this.isAlive) return;
    
    this.aiTimer += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.magnetism = Math.max(0, this.magnetism - dt);
    
    if (!this.isPlayer) this.updateAI(gameState);
    
    const sizeBasedTurnLimit = lerp(CONFIG.MIN_TURN_RADIUS, CONFIG.MAX_TURN_RADIUS, 
      Math.min(1, this.length / 50));
    
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
    
    // Update segments (follow-the-leader)
    for (let i = 1; i < this.segments.length; i++) {
      const curr = this.segments[i];
      const prev = this.segments[i-1];
      const d = dist(curr.x, curr.y, prev.x, prev.y);
      
      if (d > CONFIG.SEGMENT_SIZE) {
        const moveAngle = angle(curr.x, curr.y, prev.x, prev.y);
        const moveDist = d - CONFIG.SEGMENT_SIZE;
        curr.x += Math.cos(moveAngle) * moveDist;
        curr.y += Math.sin(moveAngle) * moveDist;
        curr.angle = moveAngle;
      }
    }
    
    // Add segments if grown
    while (this.segments.length < this.length) {
      const last = this.segments[this.segments.length - 1];
      this.segments.push({
        x: last.x - Math.cos(last.angle) * CONFIG.SEGMENT_SIZE,
        y: last.y - Math.sin(last.angle) * CONFIG.SEGMENT_SIZE,
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
    
    // MODIFIED: Wall collision is now handled by the GameEngine to centralize death logic.
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
    // Check for collision with the other snake's body segments
    return other.segments.slice(1).some(seg => 
      dist(head.x, head.y, seg.x, seg.y) < CONFIG.SEGMENT_SIZE * 0.8
    );
  }
  
  grow(amount = 1) {
    this.length += amount;
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
    const maxDist = CONFIG.SEGMENT_SIZE * (1.0 + this.segments.length * 0.01);
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
  
  /**
   * MODIFIED: The entire update loop is restructured for clarity and correctness.
   * 1. All snakes are moved.
   * 2. Collisions (wall and snake-on-snake) are detected, and snakes are marked as dead.
   * 3. Food is dropped from the snakes that just died.
   * 4. Food consumption is processed for all living snakes.
   * 5. The camera and AI respawning are handled.
   */
  update() {
    if (!this.running) return;
    
    const dt = 1;
    
    // 1. Update all snake positions and AI logic
    this.snakes.forEach(snake => snake.update(dt, {snakes: this.snakes, food: this.food}));
    
    // --- Collision, Death, and Food Drop Logic ---
    const newlyDeadSnakes = [];

    // 2. Check for collisions (walls and other snakes) for all living snakes
    this.snakes.forEach(snake => {
      if (!snake.isAlive) return; // Skip snakes that are already dead

      const head = snake.segments[0];

      // Check for wall collisions
      if (head.x < 0 || head.x > CONFIG.WORLD_W || head.y < 0 || head.y > CONFIG.WORLD_H) {
        snake.die();
        newlyDeadSnakes.push(snake);
        return; // Move to the next snake
      }

      // Check for snake-on-snake collisions
      for (const other of this.snakes) {
        if (snake.checkCollision(other)) {
          snake.die();
          newlyDeadSnakes.push(snake);
          return; // Collision found, move to the next snake
        }
      }
    });

    // 3. NEW: Drop food from the snakes that just died
    newlyDeadSnakes.forEach(deadSnake => {
      // Drop one food item for every 3 segments to prevent overwhelming the map
      deadSnake.segments.forEach((segment, index) => {
        if (index % 3 === 0) {
          // Use one of the snake's body colors for the dropped food
          const foodColor = deadSnake.colors[index % deadSnake.colors.length];
          this.food.push(new Food(segment.x, segment.y, 'normal', foodColor));
        }
      });
    });
      
    // 4. Process food consumption for all living snakes
    this.snakes.forEach(snake => {
      if (!snake.isAlive) return; // Only living snakes can eat
      
      // Iterate backwards to safely remove items while looping
      for (let i = this.food.length - 1; i >= 0; i--) {
        const food = this.food[i];
        if (snake.checkFood(food)) {
          if (food.type === 'power') {
            snake.grow(food.value);
            const powers = ['invulnerable', 'magnetism', 'speed'];
            snake.activatePower(powers[Math.floor(Math.random() * powers.length)]);
            // Replace the eaten power food
            this.food.splice(i, 1, new Food(
              Math.random() * CONFIG.WORLD_W, 
              Math.random() * CONFIG.WORLD_H,
              Math.random() < 0.2 ? 'power' : 'normal'
            ));
          } else {
            snake.grow(food.value);
            // Replace the eaten normal food
            this.food.splice(i, 1, new Food(Math.random() * CONFIG.WORLD_W, Math.random() * CONFIG.WORLD_H));
          }
        }
      }
    });
    
    // 5. Update food animations
    this.food.forEach(food => food.update());
    
    // 6. Update camera if player is alive
    if (this.player.isAlive) {
      const head = this.player.segments[0];
      this.camera.x = lerp(this.camera.x, head.x - CONFIG.CANVAS_W/2, 0.1);
      this.camera.y = lerp(this.camera.y, head.y - CONFIG.CANVAS_H/2, 0.1);
      this.score = this.player.score;
    }
    
    // 7. Respawn AI snakes if count drops
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

      snake.segments.forEach((segment, i) => {
        const x = segment.x - this.camera.x;
        const y = segment.y - this.camera.y;

        if (x > -20 && x < CONFIG.CANVAS_W + 20 && y > -20 && y < CONFIG.CANVAS_H + 20) {
          const size = i === 0 ? CONFIG.SEGMENT_SIZE * 1.2 : CONFIG.SEGMENT_SIZE;
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
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();

          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;

          if (i === 0) {
            ctx.fillStyle = '#fff';
            const eyeOffset = size * 0.4;
            const eyeSize = size * 0.2;
            ctx.beginPath();
            ctx.arc(x + Math.cos(segment.angle - 0.5) * eyeOffset,
                    y + Math.sin(segment.angle - 0.5) * eyeOffset, eyeSize, 0, Math.PI * 2);
            ctx.arc(x + Math.cos(segment.angle + 0.5) * eyeOffset,
                    y + Math.sin(segment.angle + 0.5) * eyeOffset, eyeSize, 0, Math.PI * 2);
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