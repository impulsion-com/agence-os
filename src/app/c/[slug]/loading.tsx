export default function PortalLoading() {
  return (
    <div className="ptl-skel" aria-busy="true" aria-label="Chargement">
      <span className="sk" style={{ width: 220, height: 28 }} />
      <span className="sk" style={{ width: "55%" }} />
      <span className="sk" style={{ width: "100%", height: 120, marginTop: 10 }} />
      <span className="sk" style={{ width: "100%", height: 220 }} />
    </div>
  );
}
