export const metadata = { title: "Avenzo Restaurant Partner", description: "Restaurant operations" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
