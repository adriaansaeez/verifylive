// Silueta de juez/abogado: peluca de rizos, banda sobre la frente, rostro,
// toga y las dos tiras blancas del cuello recortadas con evenodd (transparentes).
const WIG = `M 6.4 30.4
  Q 2.91 29.59 5.2 25.6
  Q 1.92 24.08 5 20.8
  Q 2.2 18.59 6 16.2
  Q 4.09 13.23 8.6 11.8
  Q 7.87 8.3 12.8 8.2
  Q 13.38 4.29 18 5.6
  Q 20.25 1.99 24 4.8
  Q 27.75 1.99 30 5.6
  Q 34.62 4.29 35.2 8.2
  Q 40.13 8.3 39.4 11.8
  Q 43.91 13.23 42 16.2
  Q 45.8 18.59 43 20.8
  Q 46.08 24.08 42.8 25.6
  Q 45.09 29.59 41.6 30.4
  Q 38.6 32 35.6 31.6
  Q 33.6 32.4 31.9 29.6
  C 31 27.6 31 25.2 31 23
  L 31 14.2
  C 31 11.5 29.9 10.4 27.8 10.4
  L 20.2 10.4
  C 18.1 10.4 17 11.5 17 14.2
  L 17 23
  C 17 25.2 17 27.6 16.1 29.6
  Q 14.4 32.4 12.4 31.6
  Q 9.4 32 6.4 30.4 Z
  M 5.2 18.4 L 11.8 18.9 L 11.8 17.7 L 5.2 17.2 Z
  M 5 25 L 11 25.5 L 11 24.3 L 5 23.8 Z
  M 42.8 18.4 L 36.2 18.9 L 36.2 17.7 L 42.8 17.2 Z
  M 43 25 L 37 25.5 L 37 24.3 L 43 23.8 Z`;

const HEAD = `M 17.8 15.6
  C 17.8 12.6 19.3 11.2 21.6 11.2
  L 26.4 11.2
  C 28.7 11.2 30.2 12.6 30.2 15.6
  L 30.2 18.6
  C 30.2 22.2 29.6 24.4 28.2 26.4
  C 27.2 27.8 25.8 29.2 24 29.2
  C 22.2 29.2 20.8 27.8 19.8 26.4
  C 18.4 24.4 17.8 22.2 17.8 18.6
  Z`;

const BUST = `M 20.2 27.4
  L 27.8 27.4
  L 27.8 30.4
  C 29.4 31.4 33.4 32 37 34
  C 42 36.6 45 41 45.4 45.8
  L 2.6 45.8
  C 3 41 6 36.6 11 34
  C 14.6 32 18.6 31.4 20.2 30.4
  Z
  M 21.1 29.9 L 23.2 30.2 L 22.6 37.2 L 20.5 36.8 Z
  M 26.9 29.9 L 24.8 30.2 L 25.4 37.2 L 27.5 36.8 Z`;

export default function JudgeMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path fillRule="evenodd" d={WIG} />
      <path d={HEAD} />
      <path fillRule="evenodd" d={BUST} />
    </svg>
  );
}
