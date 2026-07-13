export async function GET(request: Request) {
  if (request.headers.get('x-debug-key') !== 'temp-check-12345') {
    return new Response('Not found', { status: 404 });
  }

  return Response.json({
    hasDatabaseUrl: !!process.env.DATABASE_URL,
    hasDebugTest: !!process.env.DEBUG_TEST,
    envKeys: Object.keys(process.env)
      .filter(k => !k.startsWith('AWS_') && !k.startsWith('_'))
      .sort(),
  });
}
