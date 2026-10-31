// Run the unchanged upstream policy suite with our small assertion adapter.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'claude-code/testing') {
    return {url: new URL('./test-adapter.mjs', import.meta.url).href, shortCircuit: true};
  }
  return nextResolve(specifier, context);
}
