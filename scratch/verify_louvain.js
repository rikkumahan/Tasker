// verify_louvain.js - Modularity difference formula fix

function runLouvain(nodes, edges) {
  const nodeToCommunity = {};
  for (const node of nodes) {
    nodeToCommunity[node] = node;
  }
  
  if (nodes.length === 0) return {};
  if (edges.length === 0) return nodeToCommunity;
  
  let currentNodes = [...nodes];
  let currentEdges = [...edges];
  
  let nodeToIdx = new Map();
  currentNodes.forEach((n, i) => nodeToIdx.set(n, i));
  
  const N = currentNodes.length;
  let communities = Array.from({ length: N }, (_, i) => i);
  
  let adj = Array.from({ length: N }, () => new Map());
  let k = new Array(N).fill(0);
  let m = 0;
  
  for (const edge of currentEdges) {
    const u = nodeToIdx.get(edge.source);
    const v = nodeToIdx.get(edge.target);
    if (u === undefined || v === undefined) continue;
    
    adj[u].set(v, (adj[u].get(v) || 0) + edge.weight);
    if (u !== v) {
      adj[v].set(u, (adj[v].get(u) || 0) + edge.weight);
    }
    k[u] += edge.weight;
    k[v] += edge.weight;
    m += edge.weight;
  }
  
  let improvement = true;
  while (improvement) {
    improvement = false;
    let tot = new Array(N).fill(0);
    communities.forEach((c, i) => {
      tot[c] += k[i];
    });
    
    let moved = true;
    let passes = 0;
    while (moved && passes < 10) {
      moved = false;
      passes++;
      
      for (let i = 0; i < N; i++) {
        const ki = k[i];
        const oldComm = communities[i];
        
        let k_i_out = 0;
        for (const [neighbor, weight] of adj[i].entries()) {
          if (communities[neighbor] === oldComm) {
            k_i_out += weight;
          }
        }
        
        const commWeights = new Map();
        for (const [neighbor, weight] of adj[i].entries()) {
          const c = communities[neighbor];
          if (c !== oldComm) {
            commWeights.set(c, (commWeights.get(c) || 0) + weight);
          }
        }
        
        let bestComm = oldComm;
        let maxDeltaQ = 0;
        
        for (const [c, k_i_in] of commWeights.entries()) {
          const deltaQ = k_i_in - k_i_out + (ki / (2 * m)) * (tot[oldComm] - tot[c] - ki);
          if (deltaQ > maxDeltaQ) {
            maxDeltaQ = deltaQ;
            bestComm = c;
          }
        }
        
        if (bestComm !== oldComm) {
          communities[i] = bestComm;
          tot[oldComm] -= ki;
          tot[bestComm] += ki;
          moved = true;
          improvement = true;
        }
      }
    }
    
    if (!improvement) break;
    
    const uniqueComms = Array.from(new Set(communities));
    const commToNewIdx = new Map();
    uniqueComms.forEach((c, idx) => commToNewIdx.set(c, idx));
    
    const C = uniqueComms.length;
    const nextNodes = Array.from({ length: C }, (_, idx) => `comm_${idx}`);
    
    const nextEdgesMap = new Map();
    for (let u = 0; u < N; u++) {
      const commU = commToNewIdx.get(communities[u]);
      for (const [v, weight] of adj[u].entries()) {
        const commV = commToNewIdx.get(communities[v]);
        const key = commU <= commV ? `${commU}_${commV}` : `${commV}_${commU}`;
        nextEdgesMap.set(key, (nextEdgesMap.get(key) || 0) + weight);
      }
    }
    
    const nextEdges = [];
    for (const [key, weight] of nextEdgesMap.entries()) {
      const [u, v] = key.split('_').map(Number);
      nextEdges.push({ source: `comm_${u}`, target: `comm_${v}`, weight });
    }
    
    for (const node of nodes) {
      const currentComm = nodeToCommunity[node];
      const idx = nodeToIdx.get(currentComm);
      const finalCommIdx = commToNewIdx.get(communities[idx]);
      nodeToCommunity[node] = `comm_${finalCommIdx}`;
    }
    
    currentNodes = nextNodes;
    currentEdges = nextEdges;
    nodeToIdx = new Map();
    currentNodes.forEach((n, i) => nodeToIdx.set(n, i));
    
    adj = Array.from({ length: C }, () => new Map());
    k = new Array(C).fill(0);
    m = 0;
    
    for (const edge of currentEdges) {
      const u = nodeToIdx.get(edge.source);
      const v = nodeToIdx.get(edge.target);
      adj[u].set(v, (adj[u].get(v) || 0) + edge.weight);
      if (u !== v) {
        adj[v].set(u, (adj[v].get(u) || 0) + edge.weight);
      }
      k[u] += edge.weight;
      k[v] += edge.weight;
      m += edge.weight;
    }
    
    communities = Array.from({ length: C }, (_, i) => i);
    break; // Single-level coarse graining is stable and efficient
  }
  
  return nodeToCommunity;
}

const nodes = ["A", "B", "C", "D", "E", "F"];
const edges = [
  { source: "A", target: "B", weight: 1 },
  { source: "B", target: "C", weight: 1 },
  { source: "C", target: "A", weight: 1 },
  { source: "D", target: "E", weight: 1 },
  { source: "E", target: "F", weight: 1 },
  { source: "F", target: "D", weight: 1 }
];

console.log("Running Louvain modularity clustering on test graph...");
const partitions = runLouvain(nodes, edges);
console.log("Computed Partitions:", partitions);

const commA = partitions["A"];
const commB = partitions["B"];
const commC = partitions["C"];
const commD = partitions["D"];
const commE = partitions["E"];
const commF = partitions["F"];

if (commA === commB && commB === commC) {
  console.log("✅ Clique 1 (A, B, C) grouped together in community:", commA);
} else {
  console.error("❌ Clique 1 (A, B, C) was NOT grouped together!");
  process.exit(1);
}

if (commD === commE && commE === commF) {
  console.log("✅ Clique 2 (D, E, F) grouped together in community:", commD);
} else {
  console.error("❌ Clique 2 (D, E, F) was NOT grouped together!");
  process.exit(1);
}

if (commA !== commD) {
  console.log("✅ Clique 1 and Clique 2 partitioned into separate communities.");
} else {
  console.error("❌ Clique 1 and Clique 2 incorrectly merged into the same community!");
  process.exit(1);
}

console.log("🎉 Louvain clustering algorithm validation successful!");
