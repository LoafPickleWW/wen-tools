export interface GraphNode {
  id: string; // Wallet address
  label: string; // NFD domain or truncated address
  val: number; // Node weight/radius metric (e.g. transaction count)
  type: 'seed' | 'counterparty';
  isFirstBonded?: boolean;
  isExpanded?: boolean;
  sentCount: number;
  recvCount: number;
  totalCount: number;
  // Canvas force-directed coordinates
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  count: number;
  direction: 'forward' | 'backward' | 'both';
}

export interface ClusterGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
