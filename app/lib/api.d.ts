export declare const API_BASE = "http://10.162.96.146:3000";
export type College = {
    id: string;
    name: string;
    city: string;
    state: string;
    url?: string;
    size?: number | null;
};
export declare function searchColleges(q: string, state?: string): Promise<{
    results: College[];
}>;
//# sourceMappingURL=api.d.ts.map