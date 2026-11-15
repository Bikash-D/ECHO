import {
  HealthResponse,
  LocationDetailResponse,
  NeighborhoodDetailResponse,
  SimulationLifecycleResponse,
  WorldResponse,
} from "./types";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
export async function fetchHealth(): Promise<{ data: HealthResponse | null; latencyMs: number; error: string | null }> {
  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(`${API_BASE}/api/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      return { data: null, latencyMs, error: `HTTP Error ${response.status}: ${response.statusText}` };
    }

    const data: HealthResponse = await response.json();
    return { data, latencyMs, error: null };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    return { data: null, latencyMs, error: err instanceof Error ? err.message : "Failed to reach backend" };
  }
}

export async function fetchWorld(): Promise<{ data: WorldResponse | null; error: string | null }> {
  try {
    const response = await fetch(`${API_BASE}/api/world`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      return { data: null, error: `Failed to fetch world: HTTP ${response.status}` };
    }

    const data: WorldResponse = await response.json();
    return { data, error: null };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err.message : "Network error" };
  }
}

export async function fetchNeighborhoodDetail(id: string): Promise<{ data: NeighborhoodDetailResponse | null; error: string | null }> {
  try {
    const response = await fetch(`${API_BASE}/api/world/neighborhoods/${id}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      return { data: null, error: `HTTP ${response.status}` };
    }

    const data: NeighborhoodDetailResponse = await response.json();
    return { data, error: null };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err.message : "Network error" };
  }
}

export async function fetchLocationDetail(id: string): Promise<{ data: LocationDetailResponse | null; error: string | null }> {
  try {
    const response = await fetch(`${API_BASE}/api/world/locations/${id}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      return { data: null, error: `HTTP ${response.status}` };
    }

    const data: LocationDetailResponse = await response.json();
    return { data, error: null };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err.message : "Network error" };
  }
}

export async function stepSimulation(): Promise<{ data: SimulationLifecycleResponse | null; error: string | null }> {
  try {
    const response = await fetch(`${API_BASE}/api/simulation/step`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return { data: null, error: `HTTP ${response.status}` };
    const data: SimulationLifecycleResponse = await response.json();
    return { data, error: null };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err.message : "Network error" };
  }
}

export async function startSimulation(): Promise<{ data: SimulationLifecycleResponse | null; error: string | null }> {
  try {
    const response = await fetch(`${API_BASE}/api/simulation/start`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return { data: null, error: `HTTP ${response.status}` };
    const data: SimulationLifecycleResponse = await response.json();
    return { data, error: null };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err.message : "Network error" };
  }
}

export async function pauseSimulation(): Promise<{ data: SimulationLifecycleResponse | null; error: string | null }> {
  try {
    const response = await fetch(`${API_BASE}/api/simulation/pause`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return { data: null, error: `HTTP ${response.status}` };
    const data: SimulationLifecycleResponse = await response.json();
    return { data, error: null };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err.message : "Network error" };
  }
}

export async function resetSimulation(): Promise<{ data: SimulationLifecycleResponse | null; error: string | null }> {
  try {
    const response = await fetch(`${API_BASE}/api/simulation/reset`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ seed: 12345 }),
    });
    if (!response.ok) return { data: null, error: `HTTP ${response.status}` };
    const data: SimulationLifecycleResponse = await response.json();
    return { data, error: null };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err.message : "Network error" };
  }
}
