export function deterministicEcho(value) {
  return { echoed: value, runtime: "sandbox", version: 1 };
}
