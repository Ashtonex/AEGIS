export default function Custom500() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#040810", color: "#f8fafc", padding: "2rem" }}>
      <section style={{ maxWidth: "40rem" }}>
        <p style={{ marginBottom: "0.75rem", color: "#d4af37", textTransform: "uppercase", letterSpacing: "0.12em", fontSize: "0.75rem" }}>
          System notice
        </p>
        <h1 style={{ margin: 0, fontSize: "2rem", lineHeight: 1.1 }}>The workspace could not be loaded.</h1>
        <p style={{ color: "#cbd5e1", lineHeight: 1.6 }}>
          Please retry the request. If the issue continues, contact the AEGIS administrator with the time and page you were opening.
        </p>
      </section>
    </main>
  );
}