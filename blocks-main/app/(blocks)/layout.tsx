import "@/app/globals.css";

export default function BlockLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f6f3ee_0%,#f4f0e8_44%,#efe8dc_100%)]">
      {children}
    </div>
  );
}
