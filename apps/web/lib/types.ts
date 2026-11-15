export interface Need {
  need_type: string;
  value: number;
}

export interface Goal {
  id: string;
  description: string;
  priority: number;
  status: string;
  progress: number;
}

export interface Personality {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
}

export interface Agent {
  id: string;
  name: string;
  age: number;
  occupation: string;
  wealth: number;
  social_status: number;
  location_id: string;
  neighborhood_id: string;
  household_id?: string;
  workplace_id?: string;
  employer_name?: string | null;
  wage?: number | null;
  personality: Personality;
  needs: Need[];
  goals: Goal[];
  current_goal?: Goal | null;
  relationships: Relationship[];
  current_action?: AgentAction | null;
}

export interface Relationship {
  other_agent_id: string;
  other_agent_name: string;
  relationship_type: string;
  strength: number;
  trust: number;
  interactions_count: number;
  last_interaction_tick: number;
}

export interface AgentAction {
  tick: number;
  action_type: string;
  success: boolean;
  message: string;
  reasoning: string;
}

export interface Business {
  id: string;
  location_id: string;
  name: string;
  cash: number;
}

export interface Location {
  id: string;
  name: string;
  type: "residential" | "workplace" | "market" | "leisure" | string;
  neighborhood_id: string;
  capacity: number | null;
  occupancy: number;
  occupant_ids: string[];
  business?: Business | null;
  // Living City milestone Phase A: semantic identity beyond `type` (see
  // apps/api/app/world/enums.py::VenueKind). Optional here (rather than
  // required) so this type doesn't break for any older cached/mocked
  // World payload that predates this field -- real API responses always
  // populate it. Not yet consumed by any renderer as of Phase B; Phase C
  // (building archetypes) is where this actually drives building
  // silhouette choice.
  venue_kind?: string;
  architectural_style?: string;
  floor_count?: number;
  is_public?: boolean;
  interior_archetype?: string;
}

export interface Neighborhood {
  id: string;
  name: string;
  city_id: string;
  number_of_locations: number;
  population: number;
  location_ids: string[];
}

export interface City {
  id: string;
  name: string;
  neighborhood_count: number;
}

export interface SocietyStatistics {
  total_population: number;
  average_wealth: number;
  average_social_status: number;
  average_needs: Record<string, number>;
  occupation_distribution: Record<string, number>;
  total_business_cash: number;
}

export interface WorldResponse {
  city: City;
  tick: number;
  status: "initialized" | "running" | "paused" | "stopped" | string;
  neighborhoods: Neighborhood[];
  locations: Location[];
  agents: Agent[];
  statistics: SocietyStatistics;
}

export interface NeighborhoodDetailResponse {
  id: string;
  name: string;
  city_id: string;
  population: number;
  locations: Location[];
  breakdown: Record<string, number>;
  residents: Agent[];
}

export interface LocationDetailResponse {
  id: string;
  name: string;
  type: string;
  neighborhood_id: string;
  neighborhood_name: string;
  capacity: number | null;
  occupancy: number;
  occupants: Agent[];
  business?: Business | null;
  venue_kind?: string;
  architectural_style?: string;
  floor_count?: number;
  is_public?: boolean;
  interior_archetype?: string;
}

export interface SimulationLifecycleResponse {
  status: string;
  tick: number;
  population_size: number;
}

export interface HealthResponse {
  status: string;
  app: string;
  environment: string;
  simulation_profile: "dev" | "mvp" | string;
  population_size: number;
}

export interface SimulationEvent {
  id: string;
  tick: number;
  timestamp: string;
  category: "ENGINE" | "AGENT" | "WORLD" | "ECONOMY" | "INTERVENTION";
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  message: string;
  agent_id?: string;
  location_id?: string;
}

/**
 * Activity feed entry for the /city Living City view (V3).
 *
 * Distinct from SimulationEvent (which mirrors the backend's
 * ENGINE/AGENT/WORLD/ECONOMY/INTERVENTION event_queue categories --
 * currently a Phase-0 stub with no data). CityActivityEvent is derived
 * entirely client-side by diffing two consecutive real /api/world
 * snapshots (see lib/activityFeed.ts) -- every field here traces back
 * to an actual before/after change in real agent state, never invented.
 */
export interface CityActivityEvent {
  id: string;
  tick: number;
  category: "MOVEMENT" | "ACTION" | "SOCIAL" | "ECONOMY" | "GOAL";
  agentId: string;
  agentName: string;
  message: string;
  /** Optional human-readable delta line, e.g. "$5 spent · Hunger 28% -> 78%" -- only present when a real before/after value pair was observed across the two snapshots being diffed. */
  detail?: string;
}

/** Real before/after deltas observed for one agent across one tick transition, used to annotate the canvas near that agent (Step 7: causality). Only populated from actual snapshot diffs. */
export interface AgentDelta {
  tick: number;
  agentId: string;
  label: string;
}

