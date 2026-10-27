
/**
 * Min-Cost Max-Flow algorithm using the Successive Shortest
 * Augmenting Path method with Bellman-Ford.
 *
 * Graph representation:
 *   addEdge(from, to, capacity, cost)
 *
 * Node IDs must be integers from 0 to nodeCount - 1.
 */
export class MinCostMaxFlow {
  constructor(nodeCount) {
    if (!Number.isInteger(nodeCount) || nodeCount <= 0) {
      throw new Error("nodeCount must be a positive integer");
    }

    this.nodeCount = nodeCount;
    this.graph = Array.from({ length: nodeCount }, () => []);
  }

  addEdge(from, to, capacity, cost) {
    this.#validateNode(from);
    this.#validateNode(to);

    if (!Number.isInteger(capacity) || capacity < 0) {
      throw new Error("capacity must be a non-negative integer");
    }

    if (!Number.isFinite(cost)) {
      throw new Error("cost must be a finite number");
    }

    const forward = {
      to,
      rev: this.graph[to].length,
      capacity,
      cost,
      originalCapacity: capacity,
    };

    const reverse = {
      to: from,
      rev: this.graph[from].length,
      capacity: 0,
      cost: -cost,
      originalCapacity: 0,
    };

    this.graph[from].push(forward);
    this.graph[to].push(reverse);
  }

  #validateNode(node) {
    if (
      !Number.isInteger(node) ||
      node < 0 ||
      node >= this.nodeCount
    ) {
      throw new Error(`Invalid node: ${node}`);
    }
  }

  #shortestPath(source, sink) {
    const n = this.nodeCount;
    const dist = Array(n).fill(Infinity);
    const prevNode = Array(n).fill(-1);
    const prevEdge = Array(n).fill(-1);

    dist[source] = 0;

    // Bellman-Ford supports negative residual-edge costs.
    for (let iteration = 0; iteration < n - 1; iteration++) {
      let changed = false;

      for (let u = 0; u < n; u++) {
        if (dist[u] === Infinity) continue;

        for (let i = 0; i < this.graph[u].length; i++) {
          const edge = this.graph[u][i];

          if (edge.capacity <= 0) continue;

          const candidate = dist[u] + edge.cost;

          if (candidate < dist[edge.to]) {
            dist[edge.to] = candidate;
            prevNode[edge.to] = u;
            prevEdge[edge.to] = i;
            changed = true;
          }
        }
      }

      if (!changed) break;
    }

    if (dist[sink] === Infinity) {
      return null;
    }

    return { dist, prevNode, prevEdge };
  }

  solve(source, sink, maxFlow = Infinity) {
    this.#validateNode(source);
    this.#validateNode(sink);

    if (source === sink) {
      throw new Error("source and sink must be different");
    }

    if (
      maxFlow !== Infinity &&
      (!Number.isInteger(maxFlow) || maxFlow < 0)
    ) {
      throw new Error("maxFlow must be a non-negative integer");
    }

    let flow = 0;
    let cost = 0;

    while (flow < maxFlow) {
      const path = this.#shortestPath(source, sink);

      if (!path) break;

      let amount = maxFlow === Infinity
        ? Infinity
        : maxFlow - flow;

      for (let v = sink; v !== source; v = path.prevNode[v]) {
        const u = path.prevNode[v];
        if (u === -1) {
          throw new Error("Failed to reconstruct augmenting path");
        }

        const edge = this.graph[u][path.prevEdge[v]];
        amount = Math.min(amount, edge.capacity);
      }

      if (amount <= 0 || amount === Infinity) break;

      for (let v = sink; v !== source; v = path.prevNode[v]) {
        const u = path.prevNode[v];
        const edge = this.graph[u][path.prevEdge[v]];

        edge.capacity -= amount;
        this.graph[v][edge.rev].capacity += amount;
      }

      flow += amount;
      cost += amount * path.dist[sink];
    }

    return { flow, cost };
  }

  getEdges() {
    const edges = [];

    for (let from = 0; from < this.nodeCount; from++) {
      for (const edge of this.graph[from]) {
        if (edge.originalCapacity > 0) {
          edges.push({
            from,
            to: edge.to,
            capacity: edge.originalCapacity,
            flow: edge.originalCapacity - edge.capacity,
            cost: edge.cost,
          });
        }
      }
    }

    return edges;
  }
}

/**
 * Convenience function.
 *
 * edges: [{ from, to, capacity, cost }]
 * Returns: { flow, cost, edges }
 */
export function minCostMaxFlow(nodeCount, edges, source, sink, maxFlow = Infinity) {
  const network = new MinCostMaxFlow(nodeCount);

  for (const edge of edges) {
    network.addEdge(
      edge.from,
      edge.to,
      edge.capacity,
      edge.cost
    );
  }

  const result = network.solve(source, sink, maxFlow);

  return {
    ...result,
    edges: network.getEdges(),
  };
}
