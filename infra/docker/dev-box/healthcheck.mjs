try {
  await Promise.all(
    [
      "http://127.0.0.1:8020/api/ready",
      "http://127.0.0.1:8021/api/health",
      "http://127.0.0.1:8022/api/health",
    ].map(async (url) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`Unhealthy service: ${response.status}`);
    }),
  );
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
