import { Suspense } from "react";
import { StationeryBooksPanel } from "./StationeryBooksPanel";

export default function FinanceStationeryPage() {
  return (
    <Suspense fallback={null}>
      <StationeryBooksPanel />
    </Suspense>
  );
}
