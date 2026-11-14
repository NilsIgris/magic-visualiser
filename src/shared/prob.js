// Probabilités exactes (loi hypergéométrique) pour un deck mélangé au hasard.

const LF = [0];
function lnFact(n) { for (let i = LF.length; i <= n; i++) LF[i] = LF[i - 1] + Math.log(i); return LF[n]; }
export function lnChoose(n, k) { if (k < 0 || k > n) return -Infinity; return lnFact(n) - lnFact(k) - lnFact(n - k); }

/** P(X = k) : k cartes « bonnes » parmi n tirées, dans un paquet de N cartes dont K bonnes. */
export function hyperPmf(N, K, n, k) {
  if (N <= 0 || n < 0 || K < 0 || K > N || n > N) return 0;
  if (k < 0 || k > K || k > n || n - k > N - K) return 0;
  return Math.exp(lnChoose(K, k) + lnChoose(N - K, n - k) - lnChoose(N, n));
}

/** P(X ≥ k). */
export function hyperAtLeast(N, K, n, k = 1) {
  const nn = Math.min(n, N);
  let p = 0;
  for (let i = Math.max(0, k); i <= Math.min(K, nn); i++) p += hyperPmf(N, K, nn, i);
  return Math.min(1, Math.max(0, p));
}

/** Cartes vues au début du tour T (main de 7 + pioches). En multijoueur, personne ne saute sa première pioche. */
export function cardsSeen(turn, drawOnFirstTurn = true) { return 7 + (drawOnFirstTurn ? turn : Math.max(0, turn - 1)); }

/** Mélange de Fisher-Yates (aléa injectable pour les tests). */
export function shuffle(arr, rand = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
