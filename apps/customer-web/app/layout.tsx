export const metadata = { title: "Avenzo", description: "Dine-in ordering" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
