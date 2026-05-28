import React, { useRef, useEffect, useState } from "react";
import { GraphNode, GraphEdge } from "../../types/analytics";

interface ClusterGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick: (node: GraphNode) => void;
}

// Truncation helper for inside-bubble text
const getInsideLabel = (label: string, radius: number) => {
  const maxChars = Math.floor(radius / 3.4);
  if (label.length <= maxChars) return label;
  if (maxChars < 4) return "";
  return label.slice(0, Math.max(3, maxChars - 2)) + "..";
};

export function ClusterGraph({ nodes: initialNodes, edges: initialEdges, onNodeClick }: ClusterGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Simulation state
  const stateRef = useRef<{
    nodes: GraphNode[];
    edges: GraphEdge[];
    zoom: number;
    offsetX: number;
    offsetY: number;
    isPanning: boolean;
    dragNode: GraphNode | null;
    startX: number;
    startY: number;
    selectedNodeId: string | null;
    hoveredNodeId: string | null;
  }>({
    nodes: [],
    edges: [],
    zoom: 1.0,
    offsetX: 0,
    offsetY: 0,
    isPanning: false,
    dragNode: null,
    startX: 0,
    startY: 0,
    selectedNodeId: null,
    hoveredNodeId: null,
  });

  // Sync props to ref state
  useEffect(() => {
    // Keep existing coordinates if nodes persist
    const existingNodeMap = new Map(stateRef.current.nodes.map(n => [n.id, n]));
    
    const syncedNodes = initialNodes.map(node => {
      const existing = existingNodeMap.get(node.id);
      return {
        ...node,
        x: existing?.x ?? Math.random() * 400 + 100,
        y: existing?.y ?? Math.random() * 400 + 100,
        vx: existing?.vx ?? 0,
        vy: existing?.vy ?? 0,
        fx: existing?.fx ?? null,
        fy: existing?.fy ?? null,
      };
    });

    stateRef.current.nodes = syncedNodes;
    stateRef.current.edges = initialEdges;
  }, [initialNodes, initialEdges]);

  // Handle native wheel listener to allow preventDefault (non-passive)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = 1.03; // Smooth, less sensitive zoom
      const { zoom } = stateRef.current;
      const newZoom = e.deltaY < 0 ? zoom * zoomFactor : zoom / zoomFactor;
      stateRef.current.zoom = Math.max(0.2, Math.min(newZoom, 4.0));
    };

    canvas.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleNativeWheel);
    };
  }, []);

  // Main canvas animation and force sim loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;

    const runSimFrame = () => {
      const { nodes, edges, zoom, offsetX, offsetY, selectedNodeId, hoveredNodeId } = stateRef.current;

      // --- Force Simulation math ---
      const width = canvas.width;
      const height = canvas.height;
      const centerLimit = 0.05; // gravity pull

      // 1. Repulsion (push nodes apart)
      for (let i = 0; i < nodes.length; i++) {
        const u = nodes[i];
        if (u.fx !== null && u.fx !== undefined && u.fy !== null && u.fy !== undefined) continue;

        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          const v = nodes[j];

          const dx = u.x! - v.x!;
          const dy = u.y! - v.y!;
          const distSq = dx * dx + dy * dy + 0.1;
          const dist = Math.sqrt(distSq);

          if (dist < 300) {
            // Repulsion strength
            const force = 1200 / distSq;
            u.vx! += (dx / dist) * force;
            u.vy! += (dy / dist) * force;
          }
        }
      }

      // 2. Attraction (pull connected edges together)
      edges.forEach(edge => {
        const sourceNode = nodes.find(n => n.id === (typeof edge.source === "string" ? edge.source : edge.source.id));
        const targetNode = nodes.find(n => n.id === (typeof edge.target === "string" ? edge.target : edge.target.id));

        if (!sourceNode || !targetNode) return;

        const dx = targetNode.x! - sourceNode.x!;
        const dy = targetNode.y! - sourceNode.y!;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
        const desiredDist = 120;
        const k = 0.04; // spring constant

        const force = (dist - desiredDist) * k;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (sourceNode.fx === null) {
          sourceNode.vx! += fx;
          sourceNode.vy! += fy;
        }
        if (targetNode.fx === null) {
          targetNode.vx! -= fx;
          targetNode.vy! -= fy;
        }
      });

      // 3. Gravity center force & update positions
      nodes.forEach(node => {
        if (node.fx !== null && node.fx !== undefined && node.fy !== null && node.fy !== undefined) {
          node.x = node.fx;
          node.y = node.fy;
          node.vx = 0;
          node.vy = 0;
          return;
        }

        // Pull to center
        const dx = width / 2 - node.x!;
        const dy = height / 2 - node.y!;
        node.vx! += dx * centerLimit * 0.1;
        node.vy! += dy * centerLimit * 0.1;

        // Apply velocities & friction
        node.vx! *= 0.85; // friction
        node.vy! *= 0.85;
        node.x! += node.vx!;
        node.y! += node.vy!;
      });

      // --- Drawing logic ---
      ctx.clearRect(0, 0, width, height);

      // Save transform state for zoom/pan
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(zoom, zoom);

      // Draw Edges
      edges.forEach(edge => {
        const sourceNode = nodes.find(n => n.id === (typeof edge.source === "string" ? edge.source : edge.source.id));
        const targetNode = nodes.find(n => n.id === (typeof edge.target === "string" ? edge.target : edge.target.id));

        if (!sourceNode || !targetNode) return;

        const isHighlighted = hoveredNodeId && (hoveredNodeId === sourceNode.id || hoveredNodeId === targetNode.id);

        ctx.beginPath();
        ctx.moveTo(sourceNode.x!, sourceNode.y!);
        ctx.lineTo(targetNode.x!, targetNode.y!);
        ctx.strokeStyle = isHighlighted ? "#f59e0b" : "rgba(255, 255, 255, 0.15)";
        ctx.lineWidth = Math.min(2 + Math.sqrt(edge.count), 8);
        ctx.stroke();

        // Draw small flow animation dot
        if (isHighlighted || Date.now() % 2000 > 1000) {
          const t = (Date.now() % 1500) / 1500;
          const dotX = sourceNode.x! + (targetNode.x! - sourceNode.x!) * t;
          const dotY = sourceNode.y! + (targetNode.y! - sourceNode.y!) * t;

          ctx.beginPath();
          ctx.arc(dotX, dotY, 4, 0, 2 * Math.PI);
          ctx.fillStyle = "#f59e0b";
          ctx.fill();
        }
      });

      // Draw Nodes
      nodes.forEach(node => {
        const isHovered = hoveredNodeId === node.id;
        const isSelected = selectedNodeId === node.id;
        
        // Node sizing metrics
        const radius = Math.min(18 + Math.sqrt(node.sentCount) * 2, 48);

        ctx.beginPath();
        ctx.arc(node.x!, node.y!, radius, 0, 2 * Math.PI);

        // Core colors depending on transaction flow
        let color = "#f59e0b"; // amber (balanced/hub)
        if (node.sentCount / (node.totalCount || 1) > 0.6) {
          color = "#a855f7"; // purple (net sender)
        } else if (node.recvCount / (node.totalCount || 1) > 0.6) {
          color = "#22c55e"; // green (net receiver)
        }

        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = isHovered || isSelected ? 18 : 6;
        ctx.fill();
        ctx.shadowBlur = 0; // reset

        // Draw border
        ctx.strokeStyle = isSelected ? "#ffffff" : node.isExpanded ? "rgba(255, 255, 255, 0.4)" : "#ffffff";
        ctx.lineWidth = isSelected ? 3 : 1.5;
        if (!node.isExpanded) {
          ctx.setLineDash([4, 4]); // Dashed if not expanded
        } else {
          ctx.setLineDash([]);
        }
        ctx.stroke();
        ctx.setLineDash([]); // reset

        // First Bonded indicator (Draw mini star / badge)
        if (node.isFirstBonded) {
          ctx.beginPath();
          ctx.arc(node.x! + radius - 4, node.y! - radius + 4, 7, 0, 2 * Math.PI);
          ctx.fillStyle = "#ef4444"; // Red tag
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Draw Label Inside Bubble (Truncated)
        ctx.fillStyle = "#ffffff";
        ctx.font = isHovered || isSelected ? "bold 10px monospace" : "9px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const insideText = getInsideLabel(node.label, radius);
        if (insideText) {
          ctx.fillText(insideText, node.x!, node.y!);
        }
      });

      ctx.restore();

      animationFrameId = requestAnimationFrame(runSimFrame);
    };

    animationFrameId = requestAnimationFrame(runSimFrame);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  // Handle Resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    canvas.width = parent.clientWidth;
    canvas.height = 550;
  }, []);

  // Coordinate conversion helper
  const getCanvasCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { offsetX, offsetY, zoom } = stateRef.current;
    return {
      x: (clientX - rect.left - offsetX) / zoom,
      y: (clientY - rect.top - offsetY) / zoom,
    };
  };

  // Drag & Mouse Handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e.clientX, e.clientY);
    const { nodes } = stateRef.current;

    // Check if clicked a node
    const clickedNode = nodes.find(node => {
      const radius = Math.min(18 + Math.sqrt(node.sentCount) * 2, 48);
      const dx = node.x! - x;
      const dy = node.y! - y;
      return dx * dx + dy * dy < radius * radius;
    });

    if (clickedNode) {
      stateRef.current.dragNode = clickedNode;
      clickedNode.fx = clickedNode.x;
      clickedNode.fy = clickedNode.y;
      stateRef.current.selectedNodeId = clickedNode.id;
      onNodeClick(clickedNode);
    } else {
      stateRef.current.isPanning = true;
      stateRef.current.startX = e.clientX - stateRef.current.offsetX;
      stateRef.current.startY = e.clientY - stateRef.current.offsetY;
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { dragNode, isPanning, startX, startY } = stateRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    // Track mouse position relative to container
    setTooltipPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });

    if (dragNode) {
      const { x, y } = getCanvasCoords(e.clientX, e.clientY);
      dragNode.fx = x;
      dragNode.fy = y;
    } else if (isPanning) {
      stateRef.current.offsetX = e.clientX - startX;
      stateRef.current.offsetY = e.clientY - startY;
    } else {
      // Hover detection
      const { x, y } = getCanvasCoords(e.clientX, e.clientY);
      const { nodes } = stateRef.current;
      const hovered = nodes.find(node => {
        const radius = Math.min(18 + Math.sqrt(node.sentCount) * 2, 48);
        const dx = node.x! - x;
        const dy = node.y! - y;
        return dx * dx + dy * dy < radius * radius;
      });
      stateRef.current.hoveredNodeId = hovered ? hovered.id : null;
      setHoveredNode(hovered ?? null);
    }
  };

  const handleMouseUp = () => {
    const { dragNode } = stateRef.current;
    if (dragNode) {
      dragNode.fx = null;
      dragNode.fy = null;
      stateRef.current.dragNode = null;
    }
    stateRef.current.isPanning = false;
  };

  // Touch handlers mapping
  const getTouchCoords = (touch: React.Touch) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { offsetX, offsetY, zoom } = stateRef.current;
    return {
      x: (touch.clientX - rect.left - offsetX) / zoom,
      y: (touch.clientY - rect.top - offsetY) / zoom,
    };
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const { x, y } = getTouchCoords(touch);
      const { nodes } = stateRef.current;

      const clickedNode = nodes.find(node => {
        const radius = Math.min(18 + Math.sqrt(node.sentCount) * 2, 48);
        const dx = node.x! - x;
        const dy = node.y! - y;
        return dx * dx + dy * dy < radius * radius;
      });

      if (clickedNode) {
        stateRef.current.dragNode = clickedNode;
        clickedNode.fx = clickedNode.x;
        clickedNode.fy = clickedNode.y;
        stateRef.current.selectedNodeId = clickedNode.id;
        onNodeClick(clickedNode);
      } else {
        stateRef.current.isPanning = true;
        stateRef.current.startX = touch.clientX - stateRef.current.offsetX;
        stateRef.current.startY = touch.clientY - stateRef.current.offsetY;
      }
    } else if (e.touches.length === 2) {
      // Pinch to zoom initialization
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      (stateRef.current as any).lastTouchDist = Math.sqrt(dx * dx + dy * dy);
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const { dragNode, isPanning, startX, startY } = stateRef.current;

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();

      setTooltipPos({
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      });

      if (dragNode) {
        const { x, y } = getTouchCoords(touch);
        dragNode.fx = x;
        dragNode.fy = y;
      } else if (isPanning) {
        stateRef.current.offsetX = touch.clientX - startX;
        stateRef.current.offsetY = touch.clientY - startY;
      }
    } else if (e.touches.length === 2 && (stateRef.current as any).lastTouchDist) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const zoomFactor = dist / (stateRef.current as any).lastTouchDist;
      const newZoom = stateRef.current.zoom * (1 + (zoomFactor - 1) * 0.3); // dampen scale speed
      stateRef.current.zoom = Math.max(0.2, Math.min(newZoom, 4.0));
      (stateRef.current as any).lastTouchDist = dist;
    }
  };

  const handleTouchEnd = () => {
    const { dragNode } = stateRef.current;
    if (dragNode) {
      dragNode.fx = null;
      dragNode.fy = null;
      stateRef.current.dragNode = null;
    }
    stateRef.current.isPanning = false;
    (stateRef.current as any).lastTouchDist = null;
  };

  return (
    <div className="relative w-full rounded-2xl border border-secondary-gray bg-secondary-black/80 overflow-hidden shadow-inner select-none">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="block cursor-grab active:cursor-grabbing w-full"
      />

      {/* Hover Tooltip Overlay */}
      {hoveredNode && (
        <div
          className="absolute z-10 bg-slate-950/95 border border-slate-800 text-slate-300 text-[10px] rounded-xl p-3 shadow-2xl flex flex-col gap-1.5 pointer-events-none font-mono"
          style={{
            left: `${tooltipPos.x + 15}px`,
            top: `${tooltipPos.y + 15}px`,
          }}
        >
          <div className="font-bold text-white text-xs border-b border-slate-800 pb-1 truncate max-w-[220px]">
            {hoveredNode.label}
          </div>
          <div className="flex justify-between gap-6">
            <span>TX Out (Sent):</span>
            <span className="text-purple-400 font-bold">{hoveredNode.sentCount}</span>
          </div>
          <div className="flex justify-between gap-6">
            <span>TX In (Received):</span>
            <span className="text-green-400 font-bold">{hoveredNode.recvCount}</span>
          </div>
          <div className="flex justify-between gap-6">
            <span>Total TXs:</span>
            <span className="text-amber-400 font-bold">{hoveredNode.totalCount}</span>
          </div>
        </div>
      )}

      {/* Legend Indicator Overlay */}
      <div className="absolute bottom-4 left-4 bg-primary-black/90 border border-secondary-gray/50 rounded-xl p-3 text-[10px] text-slate-300 flex flex-col gap-1.5 shadow-md">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#a855f7]" />
          <span>Net Sender (&gt;60% outgoing)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#22c55e]" />
          <span>Net Receiver (&gt;60% incoming)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#f59e0b]" />
          <span>Balanced / Hub Wallet</span>
        </div>
        <div className="flex items-center gap-2 mt-1 border-t border-secondary-gray/30 pt-1">
          <div className="w-3.5 h-3.5 rounded-full border border-dashed border-white" />
          <span>Unexpanded Connection (Click to load)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <span>First Bonded (Funding Wallet)</span>
        </div>
      </div>
    </div>
  );
}
