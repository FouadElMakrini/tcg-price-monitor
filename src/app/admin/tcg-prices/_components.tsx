"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

export function SubmitButton({ children, pendingText }: { children: React.ReactNode; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="button" disabled={pending} type="submit">
      {pending ? pendingText ?? "Traitement..." : children}
    </button>
  );
}

export function SmallSubmitButton({ children, pendingText }: { children: React.ReactNode; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="button small" disabled={pending} type="submit">
      {pending ? pendingText ?? "..." : children}
    </button>
  );
}

function resolveTheme(setting: string) {
  if (setting === "system") {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return setting;
}

export function ThemePicker() {
  const [theme, setTheme] = useState("system");

  useEffect(() => {
    const saved = window.localStorage.getItem("tcg-theme") ?? "system";
    setTheme(saved);
    const apply = () => {
      document.documentElement.dataset.themeSetting = saved;
      document.documentElement.dataset.theme = resolveTheme(saved);
    };
    apply();

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener?.("change", apply);
    return () => media.removeEventListener?.("change", apply);
  }, []);

  function changeTheme(nextTheme: string) {
    setTheme(nextTheme);
    window.localStorage.setItem("tcg-theme", nextTheme);
    document.documentElement.dataset.themeSetting = nextTheme;
    document.documentElement.dataset.theme = resolveTheme(nextTheme);
  }

  return (
    <label className="theme-picker">
      <span>Thème</span>
      <select value={theme} onChange={(event) => changeTheme(event.target.value)}>
        <option value="system">Auto appareil</option>
        <option value="violet">Violet</option>
        <option value="light">Clair</option>
        <option value="dark">Sombre</option>
        <option value="ocean">Ocean</option>
        <option value="emerald">Emerald</option>
        <option value="sunset">Sunset</option>
        <option value="compact">Compact</option>
      </select>
    </label>
  );
}

export function BurgerMenu() {
  return (
    <details className="burger-menu">
      <summary aria-label="Ouvrir le menu"><span></span><span></span><span></span></summary>
      <div className="burger-panel card">
        <strong>Menu</strong>
        <nav>
          <Link href="/admin/tcg-prices">Résumé</Link>
          <Link href="/admin/tcg-prices/import">Importer</Link>
          <Link href="/admin/tcg-prices/comparatif">Comparatif</Link>
        </nav>
        <ThemePicker />
      </div>
    </details>
  );
}

type Player = "X" | "O";
type Cell = Player | null;

function winner(board: Cell[]) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  if (board.every(Boolean)) return "draw";
  return null;
}

function aiMove(board: Cell[]) {
  const empty = board.map((cell, index) => cell ? -1 : index).filter((index) => index >= 0);
  const scoreBoard = (move: number, player: Player) => {
    const copy = [...board];
    copy[move] = player;
    const result = winner(copy);
    if (result === "O") return 100;
    if (result === "X") return 90;
    if (move === 4) return 12;
    if ([0, 2, 6, 8].includes(move)) return 8;
    return 3;
  };
  const winning = empty.find((move) => scoreBoard(move, "O") === 100);
  if (winning !== undefined) return winning;
  const blocking = empty.find((move) => scoreBoard(move, "X") === 90);
  if (blocking !== undefined) return blocking;
  return empty.sort((a, b) => scoreBoard(b, "O") - scoreBoard(a, "O"))[0] ?? null;
}

export function SecretMorpion() {
  const [board, setBoard] = useState<Cell[]>(Array(9).fill(null));
  const result = useMemo(() => winner(board), [board]);

  function play(index: number) {
    if (board[index] || result) return;
    const afterHuman = [...board];
    afterHuman[index] = "X";
    const humanResult = winner(afterHuman);
    if (humanResult) {
      setBoard(afterHuman);
      return;
    }
    const move = aiMove(afterHuman);
    if (move !== null) afterHuman[move] = "O";
    setBoard(afterHuman);
  }

  return (
    <section className="secret-game card panel">
      <div>
        <p className="eyebrow">Mode secret</p>
        <h2>Morpion contre l’IA</h2>
        <p className="subtitle">Tu joues X. L’IA joue O.</p>
      </div>
      <div className="tic-board">
        {board.map((cell, index) => (
          <button key={index} onClick={() => play(index)}>{cell}</button>
        ))}
      </div>
      <div className="game-status">
        {result === "X" ? "Tu as gagné." : result === "O" ? "L’IA a gagné." : result === "draw" ? "Égalité." : "À toi de jouer."}
      </div>
      <button className="button secondary" onClick={() => setBoard(Array(9).fill(null))}>Recommencer</button>
    </section>
  );
}

type SnakePoint = { x: number; y: number };
const GRID = 14;

function randomFood(snake: SnakePoint[]) {
  const occupied = new Set(snake.map((p) => `${p.x}:${p.y}`));
  let point = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
  let guard = 0;
  while (occupied.has(`${point.x}:${point.y}`) && guard < 200) {
    point = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
    guard++;
  }
  return point;
}

export function SecretSnake() {
  const [snake, setSnake] = useState<SnakePoint[]>([{ x: 6, y: 7 }, { x: 5, y: 7 }, { x: 4, y: 7 }]);
  const [food, setFood] = useState<SnakePoint>({ x: 10, y: 7 });
  const [direction, setDirection] = useState<SnakePoint>({ x: 1, y: 0 });
  const [running, setRunning] = useState(true);
  const directionRef = useRef(direction);
  directionRef.current = direction;

  const score = snake.length - 3;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const map: Record<string, SnakePoint> = {
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        w: { x: 0, y: -1 },
        s: { x: 0, y: 1 },
        a: { x: -1, y: 0 },
        d: { x: 1, y: 0 }
      };
      const next = map[event.key];
      if (!next) return;
      event.preventDefault();
      const current = directionRef.current;
      if (current.x + next.x === 0 && current.y + next.y === 0) return;
      setDirection(next);
      setRunning(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => {
      setSnake((currentSnake) => {
        const head = currentSnake[0];
        const next = { x: head.x + directionRef.current.x, y: head.y + directionRef.current.y };
        const dead = next.x < 0 || next.y < 0 || next.x >= GRID || next.y >= GRID || currentSnake.some((p) => p.x === next.x && p.y === next.y);
        if (dead) {
          setRunning(false);
          return currentSnake;
        }
        const ate = next.x === food.x && next.y === food.y;
        const newSnake = [next, ...currentSnake];
        if (!ate) newSnake.pop();
        if (ate) setFood(randomFood(newSnake));
        return newSnake;
      });
    }, 135);
    return () => window.clearInterval(interval);
  }, [running, food]);

  function restart() {
    const base = [{ x: 6, y: 7 }, { x: 5, y: 7 }, { x: 4, y: 7 }];
    setSnake(base);
    setFood(randomFood(base));
    setDirection({ x: 1, y: 0 });
    setRunning(true);
  }

  const snakeSet = new Set(snake.map((p, index) => `${p.x}:${p.y}:${index === 0 ? "head" : "body"}`));

  return (
    <section className="secret-game card panel snake-section">
      <div>
        <p className="eyebrow">Mode secret</p>
        <h2>Snake</h2>
        <p className="subtitle">Flèches ou WASD. Score : <strong>{score}</strong></p>
      </div>
      <div className="snake-board" style={{ gridTemplateColumns: `repeat(${GRID}, 1fr)` }}>
        {Array.from({ length: GRID * GRID }).map((_, index) => {
          const x = index % GRID;
          const y = Math.floor(index / GRID);
          const isHead = snakeSet.has(`${x}:${y}:head`);
          const isBody = snake.some((p, i) => i > 0 && p.x === x && p.y === y);
          const isFood = food.x === x && food.y === y;
          return <span className={isHead ? "snake-head" : isBody ? "snake-body" : isFood ? "snake-food" : ""} key={index} />;
        })}
      </div>
      <div className="game-status">{running ? "En cours" : "Perdu. Recommence."}</div>
      <button className="button secondary" onClick={restart}>Recommencer</button>
    </section>
  );
}
