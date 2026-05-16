export default function TrackPage({ params }: { params: { token: string } }) {
  return <main><h1>Track Order — {params.token}</h1></main>;
}
