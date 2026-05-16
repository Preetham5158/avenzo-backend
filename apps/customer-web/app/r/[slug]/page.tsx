export default function RestaurantPage({ params }: { params: { slug: string } }) {
  return <main><h1>Menu — {params.slug}</h1></main>;
}
