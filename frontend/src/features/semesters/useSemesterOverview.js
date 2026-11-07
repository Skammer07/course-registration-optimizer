import { useQuery } from "@tanstack/react-query";
import { listSemesterOverview } from "../../api/semesters.js";

/** The semesters that exist and what each holds. A failure is not fatal: screens fall back to typing. */
export function useSemesterOverview() {
  return useQuery({
    queryKey: ["semesters", "overview"],
    queryFn: listSemesterOverview,
    retry: false,
    staleTime: 30_000,
  });
}
