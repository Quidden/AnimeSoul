try {
  const response = await fetch(process.argv[2], {
    signal: AbortSignal.timeout(4000),
    redirect: "error",
  });
  if (!response.ok) process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
