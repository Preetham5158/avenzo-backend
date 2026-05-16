export default async function RestaurantPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  return <main><h1>Menu — {slug}</h1></main>;
}
