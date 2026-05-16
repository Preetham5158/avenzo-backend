export default async function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return <main><h1>Track Order — {token}</h1></main>;
}
