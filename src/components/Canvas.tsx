import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  PlayIcon,
  RectangleGroupIcon,
  Squares2X2Icon,
  VideoCameraIcon,
} from "@heroicons/react/24/outline";
import type { BacktestResult, GraphCameraState, GraphEdge, GraphNode, NodeDefinition } from "../core/types";
import { ResultsPanel } from "./ResultsPanel";

interface CanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  definitions: NodeDefinition[];
  selectedNodeIds: string[];
  pendingConnection: { nodeId: string; portId: string } | null;
  documentName: string;
  isDirty: boolean;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onImport: () => void;
  onExport: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onOpenNodesLibrary: () => void;
  onOpenStrategyCollection: () => void;
  onOpenExecutionLog: () => void;
  onViewportCenterChange: (center: { x: number; y: number }) => void;
  onCameraChange: (camera: GraphCameraState) => void;
  initialCamera: GraphCameraState;
  canUndo: boolean;
  canRedo: boolean;
  canCopy: boolean;
  canCut: boolean;
  canPaste: boolean;
  canOpenExecutionLog: boolean;
  isGridSnapEnabled: boolean;
  onToggleGridSnap: () => void;
  onAutoAlign: () => void;
  onSelectSingleNode: (nodeId: string | null) => void;
  onToggleNodeSelection: (nodeId: string) => void;
  onSelectNodes: (nodeIds: string[]) => void;
  onSelectPreviewEdge: (edgeId: string | null, additive?: boolean) => void;
  onMoveNode: (nodeId: string, x: number, y: number) => void;
  onAddNode: (definitionType: string, x: number, y: number) => void;
  onStartConnection: (nodeId: string, portId: string) => void;
  onCompleteConnection: (nodeId: string, portId: string) => void;
  onRemoveEdge: (edgeId: string) => void;
  onClearPendingConnection: () => void;
  onUpdateNodeConfig: (nodeId: string, key: string, value: string | number | boolean) => void;
  onDeleteNode: (nodeId: string) => void;
  onRun: () => void;
  isRunningBacktest: boolean;
  executingNodeId: string | null;
  errorNodeId: string | null;
  backtestResult: BacktestResult | null;
  selectedPreviewEdgeIds: string[];
}

interface MenuState {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  screenX: number;
  screenY: number;
}

interface PortPosition {
  x: number;
  y: number;
  color: string;
}

interface CursorWorldPoint {
  x: number;
  y: number;
}

function areCamerasEqual(left: GraphCameraState, right: GraphCameraState) {
  return left.x === right.x && left.y === right.y && left.zoom === right.zoom;
}

function arePortPositionsEqual(
  a: Record<string, PortPosition>,
  b: Record<string, PortPosition>,
) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }

  return aKeys.every((key) => {
    const left = a[key];
    const right = b[key];
    return (
      right !== undefined &&
      left.x === right.x &&
      left.y === right.y &&
      left.color === right.color
    );
  });
}

const NODE_WIDTH = 250;
const HEADER_HEIGHT = 38;
const FIELD_HEIGHT = 42;
const FIELD_GAP = 8;
const PORT_ROW_HEIGHT = 26;
const SIDE_PORT_INSET = 6;
const PORT_DOT_SIZE = 10;
const PORT_RADIUS = PORT_DOT_SIZE / 2;
const WORLD_SIZE = 50000;
const WORLD_ORIGIN = WORLD_SIZE / 2;
function clampCamera(
  nextCamera: { x: number; y: number; zoom: number },
  canvasSize: { width: number; height: number },
) {
  return nextCamera;
}

function safeReleasePointerCapture(element: HTMLDivElement | null, pointerId: number) {
  if (!element) {
    return;
  }

  try {
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  } catch {
    // Ignore fast-release DOM exceptions from stale pointer ids.
  }
}

function edgeMidpoint(start: { x: number; y: number }, end: { x: number; y: number }) {
  const distance = Math.max(72, Math.abs(end.x - start.x) * 0.45);
  const c1 = { x: start.x + distance, y: start.y };
  const c2 = { x: end.x - distance, y: end.y };
  const t = 0.5;
  const mt = 1 - t;

  return {
    x:
      mt * mt * mt * start.x +
      3 * mt * mt * t * c1.x +
      3 * mt * t * t * c2.x +
      t * t * t * end.x,
    y:
      mt * mt * mt * start.y +
      3 * mt * mt * t * c1.y +
      3 * mt * t * t * c2.y +
      t * t * t * end.y,
  };
}

function MenuItemLabel({
  label,
  shortcut,
}: {
  label: string;
  shortcut?: string;
}) {
  return (
    <span className="menu-dropdown-item-content">
      <span>{label}</span>
      {shortcut ? <span className="menu-dropdown-shortcut">{shortcut}</span> : null}
    </span>
  );
}

export function Canvas({
  nodes,
  edges,
  definitions,
  selectedNodeIds,
  pendingConnection,
  documentName,
  isDirty,
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onImport,
  onExport,
  onUndo,
  onRedo,
  onCopy,
  onCut,
  onPaste,
  onOpenNodesLibrary,
  onOpenStrategyCollection,
  onOpenExecutionLog,
  onViewportCenterChange,
  onCameraChange,
  initialCamera,
  canUndo,
  canRedo,
  canCopy,
  canCut,
  canPaste,
  canOpenExecutionLog,
  isGridSnapEnabled,
  onToggleGridSnap,
  onAutoAlign,
  onSelectSingleNode,
  onToggleNodeSelection,
  onSelectNodes,
  onSelectPreviewEdge,
  onMoveNode,
  onAddNode,
  onStartConnection,
  onCompleteConnection,
  onRemoveEdge,
  onClearPendingConnection,
  onUpdateNodeConfig,
  onDeleteNode,
  onRun,
  isRunningBacktest,
  executingNodeId,
  errorNodeId,
  backtestResult,
  selectedPreviewEdgeIds,
}: CanvasProps) {
  const definitionMap = new Map(definitions.map((definition) => [definition.type, definition]));
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const graphLayerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const dragMoveStateRef = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean } | null>(null);
  const connectionDragRef = useRef<{
    pointerId: number;
    nodeId: string;
    portId: string;
  } | null>(null);
  const panStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const [menuState, setMenuState] = useState<MenuState | null>(null);
  const [menuCategory, setMenuCategory] = useState<string | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);
  const [isEditMenuOpen, setIsEditMenuOpen] = useState(false);
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState(initialCamera);
  const cameraRef = useRef(initialCamera);
  const [resultsHeight, setResultsHeight] = useState(360);
  const [preferredResultsHeight, setPreferredResultsHeight] = useState<number | null>(null);
  const hasUserSizedResultsRef = useRef(false);
  const [isResultsCollapsed, setIsResultsCollapsed] = useState(false);
  const [isResultsResizing, setIsResultsResizing] = useState(false);
  const [portPositions, setPortPositions] = useState<Record<string, PortPosition>>({});
  const [dragPreviewPoint, setDragPreviewPoint] = useState<{ x: number; y: number } | null>(null);
  const [cursorWorldPoint, setCursorWorldPoint] = useState<CursorWorldPoint | null>(null);
  const [hoveredDeleteEdgeId, setHoveredDeleteEdgeId] = useState<string | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [liveBoxSelectedNodeIds, setLiveBoxSelectedNodeIds] = useState<string[]>([]);
  const [editingNumberFields, setEditingNumberFields] = useState<Record<string, string>>({});
  const [hoveredHelpTooltip, setHoveredHelpTooltip] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const selectionBoxDragRef = useRef<{ pointerId: number; moved: boolean } | null>(null);
  const suppressNodeClickRef = useRef<string | null>(null);
  const suppressCanvasClickRef = useRef(false);
  const suppressNextNodeClickRef = useRef(false);
  const resizeResultsRef = useRef<{ startY: number; startHeight: number; maxHeight: number; minHeight: number } | null>(null);
  const previewPressRef = useRef<{ pointerId: number; outputKey: string; cancelled: boolean } | null>(null);

  const runFileAction = (action: () => void) => {
    setIsFileMenuOpen(false);
    setIsEditMenuOpen(false);
    setIsViewMenuOpen(false);
    action();
  };

  const groupedDefinitions = useMemo(
    () =>
      definitions.reduce<Record<string, NodeDefinition[]>>((acc, definition) => {
        acc[definition.category] ??= [];
        acc[definition.category].push(definition);
        return acc;
      }, {}),
    [definitions],
  );

  const portColor = (kind: string) => {
    switch (kind) {
      case "dataset":
      case "series":
        return "#84cc16";
      case "number":
        return "#ffab4c";
      case "boolean":
        return "#da73ff";
      case "product":
        return "#38bdf8";
      case "signal":
        return "#fb7185";
      case "any":
        return "#c084fc";
      default:
        return "#94a3b8";
    }
  };

  const shouldHideField = (node: GraphNode, fieldKey: string) =>
    node.type === "trading.execution" && fieldKey === "positionPnlPercent";

  const nodeHeight = (node: GraphNode, definition: NodeDefinition | undefined) => {
    if (!definition) {
      return 96;
    }

    const portRows = Math.max(definition.inputs.length, definition.outputs.length, 1);
    const portsHeight = 14 + portRows * PORT_ROW_HEIGHT + 10;
    const visibleFieldCount = definition.fields.filter((field) => !shouldHideField(node, field.key)).length;
    const fieldsHeight = visibleFieldCount
      ? 14 + visibleFieldCount * FIELD_HEIGHT + Math.max(0, visibleFieldCount - 1) * FIELD_GAP
      : 0;
    return HEADER_HEIGHT + portsHeight + fieldsHeight;
  };

  const getNodeCenter = (node: GraphNode) => {
    const definition = definitionMap.get(node.type);
    return {
      x: node.position.x + NODE_WIDTH / 2,
      y: node.position.y + nodeHeight(node, definition) / 2,
    };
  };

  const recenterCamera = () => {
    if (nodes.length === 0 || canvasSize.width === 0 || canvasSize.height === 0) {
      return;
    }

    const bounds = nodes.reduce(
      (acc, node) => {
        const definition = definitionMap.get(node.type);
        const height = nodeHeight(node, definition);

        return {
          minX: Math.min(acc.minX, node.position.x),
          minY: Math.min(acc.minY, node.position.y),
          maxX: Math.max(acc.maxX, node.position.x + NODE_WIDTH),
          maxY: Math.max(acc.maxY, node.position.y + height),
        };
      },
      {
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
      },
    );

    const padding = 72;
    const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
    const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
    const availableWidth = Math.max(1, canvasSize.width - padding * 2);
    const availableHeight = Math.max(1, canvasSize.height - padding * 2);
    const nextZoom = Math.min(2.2, Math.max(0.45, Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight)));
    const centerX = bounds.minX + boundsWidth / 2;
    const centerY = bounds.minY + boundsHeight / 2;

    const nextCamera = clampCamera(
      {
        zoom: nextZoom,
        x: canvasSize.width / 2 - (WORLD_ORIGIN + centerX) * nextZoom,
        y: canvasSize.height / 2 - (WORLD_ORIGIN + centerY) * nextZoom,
      },
      canvasSize,
    );
    cameraRef.current = nextCamera;
    setCamera(nextCamera);
  };

  const getPortY = (_definition: NodeDefinition | undefined, index: number) =>
    HEADER_HEIGHT + 23 + index * PORT_ROW_HEIGHT;

  const getViewportPoint = (clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const getClampedViewportPoint = (clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }

    return {
      x: Math.min(rect.width, Math.max(0, clientX - rect.left)),
      y: Math.min(rect.height, Math.max(0, clientY - rect.top)),
    };
  };

  const screenToWorld = (clientX: number, clientY: number) => {
    const point = getViewportPoint(clientX, clientY);
    const activeCamera = cameraRef.current;
    return {
      x: (point.x - activeCamera.x) / activeCamera.zoom - WORLD_ORIGIN,
      y: (point.y - activeCamera.y) / activeCamera.zoom - WORLD_ORIGIN,
    };
  };

  const screenToWorldClamped = (clientX: number, clientY: number) => {
    const point = getClampedViewportPoint(clientX, clientY);
    const activeCamera = cameraRef.current;
    return {
      x: (point.x - activeCamera.x) / activeCamera.zoom - WORLD_ORIGIN,
      y: (point.y - activeCamera.y) / activeCamera.zoom - WORLD_ORIGIN,
    };
  };

  const getViewportCenterWorld = () => {
    const activeCamera = cameraRef.current;
    return {
      x: (canvasSize.width / 2 - activeCamera.x) / activeCamera.zoom - WORLD_ORIGIN,
      y: (canvasSize.height / 2 - activeCamera.y) / activeCamera.zoom - WORLD_ORIGIN,
    };
  };

  const visibleFields = (node: GraphNode, definition: NodeDefinition | undefined) => {
    if (!definition) {
      return [];
    }

    return definition.fields.filter((field) => !shouldHideField(node, field.key));
  };

  const getNumberFieldKey = (nodeId: string, fieldKey: string) => `${nodeId}:${fieldKey}`;

  const updateMenuPosition = (clientX: number, clientY: number) => {
    const point = getViewportPoint(clientX, clientY);
    const world = screenToWorld(clientX, clientY);
    setMenuState({
      x: point.x,
      y: point.y,
      worldX: world.x,
      worldY: world.y,
      screenX: clientX,
      screenY: clientY,
    });
    setMenuCategory(null);
  };

  useLayoutEffect(() => {
    if (!menuState || !contextMenuRef.current) {
      return;
    }

    const rect = contextMenuRef.current.getBoundingClientRect();
    const nextScreenX = Math.min(Math.max(0, menuState.screenX), Math.max(0, window.innerWidth - rect.width));
    const nextScreenY = Math.min(Math.max(0, menuState.screenY), Math.max(0, window.innerHeight - rect.height));

    if (nextScreenX !== menuState.screenX || nextScreenY !== menuState.screenY) {
      setMenuState((current) =>
        current
          ? {
              ...current,
              screenX: nextScreenX,
              screenY: nextScreenY,
            }
          : current,
      );
    }
  }, [menuState, menuCategory]);

  const findPortCenter = (nodeId: string, portId: string, side: "input" | "output") => {
    const portKey = `${nodeId}:${portId}:${side}`;
    const measured = portPositions[portKey];
    if (measured) {
      return measured;
    }

    const node = nodes.find((entry) => entry.id === nodeId);
    if (!node) {
      return null;
    }

    const definition = definitionMap.get(node.type);
    const ports = side === "input" ? definition?.inputs ?? [] : definition?.outputs ?? [];
    const index = ports.findIndex((port) => port.id === portId);

    if (index === -1) {
      return null;
    }

    return {
      x:
        WORLD_ORIGIN +
        node.position.x +
        (side === "input"
          ? SIDE_PORT_INSET + PORT_RADIUS
          : NODE_WIDTH - SIDE_PORT_INSET - PORT_RADIUS),
      y: WORLD_ORIGIN + node.position.y + getPortY(definition, index),
      color: portColor(ports[index].kind),
    };
  };

  const buildEdgePath = (edge: GraphEdge) => {
    const start = findPortCenter(edge.fromNodeId, edge.fromPortId, "output");
    const end = findPortCenter(edge.toNodeId, edge.toPortId, "input");

    if (!start || !end) {
      return null;
    }

    const distance = Math.max(72, Math.abs(end.x - start.x) * 0.45);
    return {
      d: `M ${start.x} ${start.y} C ${start.x + distance} ${start.y}, ${end.x - distance} ${end.y}, ${end.x} ${end.y}`,
      start,
    };
  };

  const buildPreviewPath = () => {
    if (!pendingConnection || !dragPreviewPoint) {
      return null;
    }

    const start = findPortCenter(pendingConnection.nodeId, pendingConnection.portId, "output");
    if (!start) {
      return null;
    }

    const end = snappedPreviewTarget
      ? {
          x: WORLD_ORIGIN + snappedPreviewTarget.x,
          y: WORLD_ORIGIN + snappedPreviewTarget.y,
        }
      : {
          x: WORLD_ORIGIN + dragPreviewPoint.x,
          y: WORLD_ORIGIN + dragPreviewPoint.y,
        };
    const distance = Math.max(72, Math.abs(end.x - start.x) * 0.45);

    return {
      d: `M ${start.x} ${start.y} C ${start.x + distance} ${start.y}, ${end.x - distance} ${end.y}, ${end.x} ${end.y}`,
      start,
    };
  };

  const snappedPreviewTarget = useMemo(() => {
    if (!pendingConnection || !dragPreviewPoint) {
      return null;
    }

    const candidates = Object.entries(portPositions)
      .filter(([key]) => key.endsWith(":input"))
      .map(([key, value]) => {
        const [nodeId, portId] = key.split(":");
        return {
          key,
          nodeId,
          portId,
          x: value.x - WORLD_ORIGIN,
          y: value.y - WORLD_ORIGIN,
        };
      });

    let closest: { nodeId: string; portId: string; x: number; y: number; distance: number } | null = null;
    for (const candidate of candidates) {
      if (candidate.nodeId === pendingConnection.nodeId) {
        continue;
      }
      const distance = Math.hypot(candidate.x - dragPreviewPoint.x, candidate.y - dragPreviewPoint.y);
      if (distance <= 26 && (!closest || distance < closest.distance)) {
        closest = { ...candidate, distance };
      }
    }

    return closest;
  }, [pendingConnection, dragPreviewPoint, portPositions]);

  const hoveredEdgeDistances = useMemo(() => {
    const distances = new Map<string, { x: number; y: number; opacity: number }>();
    if (!cursorWorldPoint) {
      return distances;
    }

    for (const edge of edges) {
      const start = findPortCenter(edge.fromNodeId, edge.fromPortId, "output");
      const end = findPortCenter(edge.toNodeId, edge.toPortId, "input");
      if (!start || !end) {
        continue;
      }

      const midpointWorld = {
        x: edgeMidpoint(start, end).x - WORLD_ORIGIN,
        y: edgeMidpoint(start, end).y - WORLD_ORIGIN,
      };
      const distance = Math.hypot(midpointWorld.x - cursorWorldPoint.x, midpointWorld.y - cursorWorldPoint.y);
      const maxDistance = 90;
      const opacity = Math.max(0, 1 - distance / maxDistance);
      if (opacity > 0) {
        distances.set(edge.id, {
          x: midpointWorld.x,
          y: midpointWorld.y,
          opacity,
        });
      }
    }

    return distances;
  }, [cursorWorldPoint, edges, portPositions]);

  const previewableOutputKeys = useMemo(
    () => new Set(Object.keys(backtestResult?.previewSeriesByEdgeId ?? {})),
    [backtestResult],
  );
  const selectedPreviewEdgeSet = useMemo(() => new Set(selectedPreviewEdgeIds), [selectedPreviewEdgeIds]);

  const stopAllInteractions = () => {
    dragStateRef.current = null;
    dragMoveStateRef.current = null;
    panStateRef.current = null;
    connectionDragRef.current = null;
    setDragPreviewPoint(null);
  };

  const selectedNodeSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const effectiveSelectedNodeSet = useMemo(
    () => new Set(selectionBox ? liveBoxSelectedNodeIds : selectedNodeIds),
    [selectionBox, liveBoxSelectedNodeIds, selectedNodeIds],
  );

  const getNodesInsideSelectionBox = (box: { startX: number; startY: number; endX: number; endY: number }) => {
    const left = Math.min(box.startX, box.endX);
    const right = Math.max(box.startX, box.endX);
    const top = Math.min(box.startY, box.endY);
    const bottom = Math.max(box.startY, box.endY);

    return nodes
      .filter((node) => {
        const nodeLeft = node.position.x;
        const nodeRight = node.position.x + NODE_WIDTH;
        const nodeTop = node.position.y;
        const nodeBottom = node.position.y + nodeHeight(node, definitionMap.get(node.type));
        return !(nodeRight < left || nodeLeft > right || nodeBottom < top || nodeTop > bottom);
      })
      .map((node) => node.id);
  };

  useEffect(() => {
    const handleWindowBlur = () => {
      stopAllInteractions();
      onClearPendingConnection();
      setSelectionBox(null);
      setLiveBoxSelectedNodeIds([]);
      setIsFileMenuOpen(false);
      setIsEditMenuOpen(false);
      setIsViewMenuOpen(false);
    };

    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    const closeMenus = () => {
      setMenuState(null);
      setMenuCategory(null);
      setIsFileMenuOpen(false);
      setIsEditMenuOpen(false);
      setIsViewMenuOpen(false);
    };

    window.addEventListener("click", closeMenus);
    return () => window.removeEventListener("click", closeMenus);
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }

    const syncSize = () => {
      setCanvasSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };

    syncSize();

    const observer = new ResizeObserver(syncSize);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setCamera((current) => {
      const nextCamera = clampCamera(current, canvasSize);
      cameraRef.current = nextCamera;
      return nextCamera;
    });
  }, [canvasSize]);

  useEffect(() => {
    setCamera((current) => {
      const nextCamera = areCamerasEqual(current, initialCamera) ? current : initialCamera;
      cameraRef.current = nextCamera;
      return nextCamera;
    });
  }, [initialCamera.x, initialCamera.y, initialCamera.zoom]);

  useEffect(() => {
    cameraRef.current = camera;
    onViewportCenterChange(getViewportCenterWorld());
    onCameraChange(camera);
  }, [camera.x, camera.y, camera.zoom, canvasSize.width, canvasSize.height, onViewportCenterChange, onCameraChange]);

  useLayoutEffect(() => {
    const layer = graphLayerRef.current;
    if (!layer) {
      return;
    }

    const layerRect = layer.getBoundingClientRect();
    const nextPositions: Record<string, PortPosition> = {};
    const portElements = layer.querySelectorAll<HTMLElement>("[data-port-key]");

    portElements.forEach((element) => {
      const key = element.dataset.portKey;
      const color = element.dataset.portColor;
      if (!key || !color) {
        return;
      }

      const rect = element.getBoundingClientRect();
      nextPositions[key] = {
        x: (rect.left + rect.width / 2 - layerRect.left) / camera.zoom,
        y: (rect.top + rect.height / 2 - layerRect.top) / camera.zoom,
        color,
      };
    });

    setPortPositions((current) => (arePortPositionsEqual(current, nextPositions) ? current : nextPositions));
  }, [nodes, camera, canvasSize]);

  return (
    <main className="editor-shell">
      <div className="menu-bar">
        <div className="menu-bar-section menu-bar-left">
          <div className="menu-dropdown" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className={`menu-button menu-dropdown-trigger ${isFileMenuOpen ? "is-open" : ""}`}
              onClick={() => {
                setIsEditMenuOpen(false);
                setIsViewMenuOpen(false);
                setIsFileMenuOpen((current) => !current);
              }}
              onPointerEnter={() => {
                if (isEditMenuOpen || isViewMenuOpen) {
                  setIsEditMenuOpen(false);
                  setIsViewMenuOpen(false);
                  setIsFileMenuOpen(true);
                }
              }}
            >
              File
            </button>
            {isFileMenuOpen ? (
              <div className="menu-dropdown-panel">
                <button type="button" className="menu-dropdown-item" onClick={() => runFileAction(onNew)}>
                  <MenuItemLabel label="New" shortcut="Ctrl+N" />
                </button>
                <button type="button" className="menu-dropdown-item" onClick={() => runFileAction(onOpen)}>
                  <MenuItemLabel label="Open" shortcut="Ctrl+O" />
                </button>
                <button type="button" className="menu-dropdown-item" onClick={() => runFileAction(onSave)}>
                  <MenuItemLabel label="Save" shortcut="Ctrl+S" />
                </button>
                <button type="button" className="menu-dropdown-item" onClick={() => runFileAction(onSaveAs)}>
                  <MenuItemLabel label="Save As" shortcut="Ctrl+Shift+S" />
                </button>
                <div className="menu-dropdown-separator" />
                <button type="button" className="menu-dropdown-item" onClick={() => runFileAction(onImport)}>
                  <MenuItemLabel label="Import" />
                </button>
                <button type="button" className="menu-dropdown-item" onClick={() => runFileAction(onExport)}>
                  <MenuItemLabel label="Export" />
                </button>
              </div>
            ) : null}
          </div>
          <div className="menu-dropdown" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className={`menu-button menu-dropdown-trigger ${isEditMenuOpen ? "is-open" : ""}`}
              onClick={() => {
                setIsFileMenuOpen(false);
                setIsViewMenuOpen(false);
                setIsEditMenuOpen((current) => !current);
              }}
              onPointerEnter={() => {
                if (isFileMenuOpen || isViewMenuOpen) {
                  setIsFileMenuOpen(false);
                  setIsViewMenuOpen(false);
                  setIsEditMenuOpen(true);
                }
              }}
            >
              Edit
            </button>
            {isEditMenuOpen ? (
              <div className="menu-dropdown-panel">
                <button type="button" className="menu-dropdown-item" onClick={() => runFileAction(onUndo)} disabled={!canUndo}>
                  <MenuItemLabel label="Undo" shortcut="Ctrl+Z" />
                </button>
                <button type="button" className="menu-dropdown-item" onClick={() => runFileAction(onRedo)} disabled={!canRedo}>
                  <MenuItemLabel label="Redo" shortcut="Ctrl+Shift+Z" />
                </button>
                <div className="menu-dropdown-separator" />
                <button type="button" className="menu-dropdown-item" onClick={() => runFileAction(onCopy)} disabled={!canCopy}>
                  <MenuItemLabel label="Copy" shortcut="Ctrl+C" />
                </button>
                <button type="button" className="menu-dropdown-item" onClick={() => runFileAction(onCut)} disabled={!canCut}>
                  <MenuItemLabel label="Cut" shortcut="Ctrl+X" />
                </button>
                <button type="button" className="menu-dropdown-item" onClick={() => runFileAction(onPaste)} disabled={!canPaste}>
                  <MenuItemLabel label="Paste" shortcut="Ctrl+V" />
                </button>
              </div>
            ) : null}
          </div>
          <div className="menu-dropdown" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className={`menu-button menu-dropdown-trigger ${isViewMenuOpen ? "is-open" : ""}`}
              onClick={() => {
                setIsFileMenuOpen(false);
                setIsEditMenuOpen(false);
                setIsViewMenuOpen((current) => !current);
              }}
              onPointerEnter={() => {
                if (isFileMenuOpen || isEditMenuOpen) {
                  setIsFileMenuOpen(false);
                  setIsEditMenuOpen(false);
                  setIsViewMenuOpen(true);
                }
              }}
            >
              View
            </button>
            {isViewMenuOpen ? (
              <div className="menu-dropdown-panel">
                <button type="button" className="menu-dropdown-item" onClick={() => runFileAction(onOpenNodesLibrary)}>
                  <MenuItemLabel label="Nodes Library" shortcut="Space" />
                </button>
                <button type="button" className="menu-dropdown-item" onClick={() => runFileAction(onOpenStrategyCollection)}>
                  <MenuItemLabel label="Strategy Collection" />
                </button>
                <button type="button" className="menu-dropdown-item" onClick={() => runFileAction(onOpenExecutionLog)} disabled={!canOpenExecutionLog}>
                  <MenuItemLabel label="Execution Log" />
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="menu-bar-center">
          <span className="document-name">{documentName}</span>
        </div>
        <div className="menu-bar-status menu-bar-right">
          {isDirty ? <span className="document-dirty">Unsaved</span> : <span className="document-saved">Saved</span>}
        </div>
      </div>

      <div
        ref={viewportRef}
        className="canvas-screen"
        style={
          {
            "--grid-offset-x": `${camera.x}px`,
            "--grid-offset-y": `${camera.y}px`,
            "--grid-size": `${36 * camera.zoom}px`,
          } as CSSProperties
        }
        onClick={() => {
          if (suppressCanvasClickRef.current) {
            suppressCanvasClickRef.current = false;
            return;
          }
          onSelectSingleNode(null);
          onSelectPreviewEdge(null);
          setMenuState(null);
          setMenuCategory(null);
        }}
        onMouseDown={(event) => {
          if (event.button === 1) {
            event.preventDefault();
          }
        }}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
          }
        }}
        onPointerDown={(event) => {
          setHoveredHelpTooltip(null);
          if (
            event.target instanceof Element &&
            event.target.closest(".node-card, .context-menu, .run-button, .pending-connection-pill, .canvas-fab")
          ) {
            return;
          }

          if (event.button !== 0) {
            return;
          }

          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            try {
              viewportRef.current?.setPointerCapture(event.pointerId);
            } catch {
              // Ignore capture failures and continue with local drag state.
            }
            const world = screenToWorld(event.clientX, event.clientY);
            selectionBoxDragRef.current = {
              pointerId: event.pointerId,
              moved: false,
            };
            setSelectionBox({
              startX: world.x,
              startY: world.y,
              endX: world.x,
              endY: world.y,
            });
            setLiveBoxSelectedNodeIds([]);
            return;
          }

          event.preventDefault();
          try {
            viewportRef.current?.setPointerCapture(event.pointerId);
          } catch {
            // Ignore capture failures and continue with local drag state.
          }
          panStateRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: cameraRef.current.x,
            originY: cameraRef.current.y,
            moved: false,
          };
          setMenuState(null);
          setMenuCategory(null);
        }}
        onPointerMove={(event) => {
          if (resizeResultsRef.current) {
            const deltaY = resizeResultsRef.current.startY - event.clientY;
            const { minHeight, maxHeight, startHeight } = resizeResultsRef.current;
            setResultsHeight(Math.min(maxHeight, Math.max(minHeight, startHeight + deltaY)));
            return;
          }

          setCursorWorldPoint(screenToWorld(event.clientX, event.clientY));

          if (event.buttons === 0) {
            if (connectionDragRef.current) {
              onClearPendingConnection();
            }
            stopAllInteractions();
            setSelectionBox(null);
            return;
          }

          if (selectionBox) {
            const world = screenToWorldClamped(event.clientX, event.clientY);
            setSelectionBox((current) => {
              if (!current) {
                return current;
              }

              if (
                selectionBoxDragRef.current &&
                selectionBoxDragRef.current.pointerId === event.pointerId &&
                !selectionBoxDragRef.current.moved
              ) {
                const deltaX = world.x - current.startX;
                const deltaY = world.y - current.startY;
                if (Math.hypot(deltaX, deltaY) > 3 / Math.max(cameraRef.current.zoom, 0.0001)) {
                  selectionBoxDragRef.current.moved = true;
                }
              }

              const nextBox = {
                ...current,
                endX: world.x,
                endY: world.y,
              };
              if (selectionBoxDragRef.current?.moved) {
                setLiveBoxSelectedNodeIds(getNodesInsideSelectionBox(nextBox));
              }
              return nextBox;
            });
            return;
          }

          if (connectionDragRef.current && event.pointerId === connectionDragRef.current.pointerId) {
            const world = screenToWorld(event.clientX, event.clientY);
            setDragPreviewPoint(world);
            return;
          }

          if (dragStateRef.current) {
            if (
              dragMoveStateRef.current &&
              event.pointerId === dragMoveStateRef.current.pointerId &&
              !dragMoveStateRef.current.moved
            ) {
              const deltaX = event.clientX - dragMoveStateRef.current.startX;
              const deltaY = event.clientY - dragMoveStateRef.current.startY;
              if (Math.hypot(deltaX, deltaY) > 3) {
                dragMoveStateRef.current.moved = true;
              }
            }

            const world = screenToWorld(event.clientX, event.clientY);
            onMoveNode(dragStateRef.current.nodeId, world.x - dragStateRef.current.offsetX, world.y - dragStateRef.current.offsetY);
            return;
          }

          if (panStateRef.current && event.pointerId === panStateRef.current.pointerId) {
            if ((event.buttons & 1) === 0) {
              panStateRef.current = null;
              return;
            }
            const panState = panStateRef.current;
            if (!panState.moved) {
              const deltaX = event.clientX - panState.startX;
              const deltaY = event.clientY - panState.startY;
              if (Math.hypot(deltaX, deltaY) > 3) {
                panState.moved = true;
              }
            }
            setCamera((current) => {
              const nextCamera = clampCamera(
                {
                  ...current,
                  x: panState.originX + (event.clientX - panState.startX),
                  y: panState.originY + (event.clientY - panState.startY),
                },
                canvasSize,
              );
              cameraRef.current = nextCamera;
              return nextCamera;
            });
          }
        }}
        onPointerUp={(event) => {
          resizeResultsRef.current = null;
          setIsResultsResizing(false);
          previewPressRef.current = null;
          if (panStateRef.current?.moved) {
            suppressCanvasClickRef.current = true;
          }
          if (dragMoveStateRef.current?.moved) {
            suppressNextNodeClickRef.current = true;
          }

          if (selectionBox) {
            if (selectionBoxDragRef.current?.moved) {
              const boxSelected = getNodesInsideSelectionBox(selectionBox);
              onSelectNodes(boxSelected);
              suppressCanvasClickRef.current = true;
            }
            setSelectionBox(null);
            setLiveBoxSelectedNodeIds([]);
            selectionBoxDragRef.current = null;
          }

          if (connectionDragRef.current && event.pointerId === connectionDragRef.current.pointerId) {
            if (snappedPreviewTarget) {
              onCompleteConnection(snappedPreviewTarget.nodeId, snappedPreviewTarget.portId);
            } else {
              const target = document.elementFromPoint(event.clientX, event.clientY);
              if (target instanceof HTMLElement) {
                const inputTarget = target.closest<HTMLElement>("[data-input-node-id][data-input-port-id]");
                if (inputTarget) {
                  const nodeId = inputTarget.dataset.inputNodeId;
                  const portId = inputTarget.dataset.inputPortId;
                  if (nodeId && portId) {
                    onCompleteConnection(nodeId, portId);
                  } else {
                    onClearPendingConnection();
                  }
                } else {
                  onClearPendingConnection();
                }
              } else {
                onClearPendingConnection();
              }
            }
          }

          safeReleasePointerCapture(viewportRef.current, event.pointerId);
          stopAllInteractions();
        }}
        onPointerCancel={(event) => {
          resizeResultsRef.current = null;
          setIsResultsResizing(false);
          previewPressRef.current = null;
          selectionBoxDragRef.current = null;
          if (connectionDragRef.current && event.pointerId === connectionDragRef.current.pointerId) {
            onClearPendingConnection();
          }
          safeReleasePointerCapture(viewportRef.current, event.pointerId);
          stopAllInteractions();
          setSelectionBox(null);
          setLiveBoxSelectedNodeIds([]);
        }}
        onLostPointerCapture={() => {
          resizeResultsRef.current = null;
          setIsResultsResizing(false);
          previewPressRef.current = null;
          selectionBoxDragRef.current = null;
          stopAllInteractions();
          setSelectionBox(null);
          setLiveBoxSelectedNodeIds([]);
        }}
        onWheel={(event) => {
          event.preventDefault();
          if (panStateRef.current) {
            return;
          }
          const point = getViewportPoint(event.clientX, event.clientY);
          setCamera((current) => {
            const nextZoom = Math.min(2.2, Math.max(0.45, current.zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
            const worldX = (point.x - current.x) / current.zoom;
            const worldY = (point.y - current.y) / current.zoom;
            const nextCamera = clampCamera(
              {
                zoom: nextZoom,
                x: point.x - worldX * nextZoom,
                y: point.y - worldY * nextZoom,
              },
              canvasSize,
            );
            cameraRef.current = nextCamera;
            return nextCamera;
          });
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setHoveredHelpTooltip(null);
          updateMenuPosition(event.clientX, event.clientY);
        }}
        onPointerLeave={() => {
          setCursorWorldPoint(null);
          setHoveredHelpTooltip(null);
        }}
      >
        <div
          ref={graphLayerRef}
          className="graph-layer"
          style={{
            width: `${WORLD_SIZE}px`,
            height: `${WORLD_SIZE}px`,
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
          }}
        >
          <svg className="edge-layer" width={WORLD_SIZE} height={WORLD_SIZE} aria-hidden="true">
            {edges.map((edge) => {
              const path = buildEdgePath(edge);
              if (!path) {
                return null;
              }

              return (
                <g key={edge.id}>
                  <path className="edge-shadow" d={path.d} />
                  <path
                    className={`edge-wire ${selectedPreviewEdgeSet.has(`${edge.fromNodeId}:${edge.fromPortId}`) ? "is-preview-selected" : ""}`}
                    d={path.d}
                    style={{ stroke: path.start.color }}
                  />
                </g>
              );
            })}
            {(() => {
              const preview = buildPreviewPath();
              if (!preview) {
                return null;
              }

              return (
                <g>
                  <path className="edge-shadow" d={preview.d} />
                  <path className="edge-wire edge-wire-preview" d={preview.d} style={{ stroke: preview.start.color }} />
                </g>
              );
            })()}
          </svg>

          {nodes.map((node) => {
            const definition = definitionMap.get(node.type);
            const height = nodeHeight(node, definition);
            const portRows = Math.max(definition?.inputs.length ?? 0, definition?.outputs.length ?? 0, 1);
            const nodeVisibleFields = visibleFields(node, definition);

            return (
              <div
                key={node.id}
                className={`node-card ${effectiveSelectedNodeSet.has(node.id) ? "is-selected" : ""} ${executingNodeId === node.id ? "is-running" : ""} ${errorNodeId === node.id ? "is-error" : ""}`}
                style={{
                  left: `${WORLD_ORIGIN + node.position.x}px`,
                  top: `${WORLD_ORIGIN + node.position.y}px`,
                  width: `${NODE_WIDTH}px`,
                  minHeight: `${height}px`,
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (suppressNextNodeClickRef.current) {
                    suppressNextNodeClickRef.current = false;
                    return;
                  }
                  if (suppressNodeClickRef.current === node.id) {
                    suppressNodeClickRef.current = null;
                    return;
                  }
                  if (event.ctrlKey) {
                    onToggleNodeSelection(node.id);
                  } else if (!effectiveSelectedNodeSet.has(node.id) || selectedNodeIds.length > 1) {
                    onSelectSingleNode(node.id);
                  }
                }}
              >
                <div className="node-card-shell">
                  <div
                    className="node-header drag-handle"
                    style={{ background: definition?.color ?? "#334155" }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      if (event.ctrlKey) {
                        event.preventDefault();
                        suppressNodeClickRef.current = node.id;
                        onToggleNodeSelection(node.id);
                        dragStateRef.current = null;
                        dragMoveStateRef.current = null;
                      } else if (!effectiveSelectedNodeSet.has(node.id)) {
                        onSelectSingleNode(node.id);
                      }

                      if (event.ctrlKey || event.metaKey) {
                        return;
                      }

                      const world = screenToWorld(event.clientX, event.clientY);
                      dragStateRef.current = {
                        nodeId: node.id,
                        offsetX: world.x - node.position.x,
                        offsetY: world.y - node.position.y,
                      };
                      dragMoveStateRef.current = {
                        pointerId: event.pointerId,
                        startX: event.clientX,
                        startY: event.clientY,
                        moved: false,
                      };
                    }}
                  >
                    <span className="node-header-title">{node.title}</span>
                    <button
                      type="button"
                      className="node-delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteNode(node.id);
                      }}
                    >
                      ×
                    </button>
                  </div>

                  <div className="node-body">
                    {Array.from({ length: portRows }).map((_, index) => {
                    const input = definition?.inputs[index];
                    const output = definition?.outputs[index];

                    return (
                      <div key={`${node.id}-row-${index}`} className="port-row">
                        <div className="port-slot is-input">
                          {input ? (
                            <button
                              type="button"
                              className={`port-button ${pendingConnection ? "is-connectable" : ""}`}
                              data-input-node-id={node.id}
                              data-input-port-id={input.id}
                            >
                              <span
                                className="port-dot"
                                style={{ background: portColor(input.kind) }}
                                data-port-key={`${node.id}:${input.id}:input`}
                                data-port-color={portColor(input.kind)}
                              />
                              <span className="port-label">{input.label}</span>
                            </button>
                          ) : (
                            <span />
                          )}
                        </div>

                        <div className="port-slot is-output">
                          {output ? (
                            <button
                              type="button"
                              className={`port-button ${
                                pendingConnection?.nodeId === node.id && pendingConnection.portId === output.id
                                  ? "is-active"
                                  : ""
                              }`}
                              onPointerDown={(event) => {
                                event.stopPropagation();
                                event.preventDefault();
                                if (!effectiveSelectedNodeSet.has(node.id)) {
                                  onSelectSingleNode(node.id);
                                }
                                try {
                                  viewportRef.current?.setPointerCapture(event.pointerId);
                                } catch {
                                  // Ignore capture failures and continue with local drag state.
                                }
                                onStartConnection(node.id, output.id);
                                connectionDragRef.current = {
                                  pointerId: event.pointerId,
                                  nodeId: node.id,
                                  portId: output.id,
                                };
                                setDragPreviewPoint(screenToWorld(event.clientX, event.clientY));
                              }}
                            >
                              <span className="port-output-meta">
                                <span
                                  className={`port-label ${previewableOutputKeys.has(`${node.id}:${output.id}`) ? "is-previewable" : ""} ${
                                    selectedPreviewEdgeSet.has(`${node.id}:${output.id}`) ? "is-preview-selected" : ""
                                  }`}
                                  onPointerDown={(event) => {
                                    const outputKey = `${node.id}:${output.id}`;
                                    if (!previewableOutputKeys.has(outputKey)) {
                                      return;
                                    }

                                    event.stopPropagation();
                                    event.preventDefault();
                                    previewPressRef.current = {
                                      pointerId: event.pointerId,
                                      outputKey,
                                      cancelled: false,
                                    };
                                  }}
                                  onPointerLeave={(event) => {
                                    if (
                                      previewPressRef.current &&
                                      previewPressRef.current.pointerId === event.pointerId
                                    ) {
                                      previewPressRef.current.cancelled = true;
                                    }
                                  }}
                                  onPointerUp={(event) => {
                                    const outputKey = `${node.id}:${output.id}`;
                                    if (
                                      !previewPressRef.current ||
                                      previewPressRef.current.pointerId !== event.pointerId ||
                                      previewPressRef.current.outputKey !== outputKey ||
                                      previewPressRef.current.cancelled
                                    ) {
                                      previewPressRef.current = null;
                                      return;
                                    }

                                    event.stopPropagation();
                                    event.preventDefault();
                                    if (previewableOutputKeys.has(outputKey)) {
                                      onSelectPreviewEdge(outputKey, event.ctrlKey || event.metaKey);
                                      if (isResultsCollapsed) {
                                        setIsResultsCollapsed(false);
                                      }
                                    }
                                    previewPressRef.current = null;
                                  }}
                                >
                                  {output.label}
                                </span>
                                {node.type === "trading.execution" && output.id === "positionPnl" ? (
                                  <label
                                    className="port-inline-toggle"
                                    onPointerDown={(event) => {
                                      event.stopPropagation();
                                    }}
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <span className="port-inline-toggle-prefix">%</span>
                                    <input
                                      type="checkbox"
                                      checked={Boolean(node.config.positionPnlPercent)}
                                      onChange={(event) =>
                                        onUpdateNodeConfig(node.id, "positionPnlPercent", event.target.checked)
                                      }
                                    />
                                  </label>
                                ) : null}
                              </span>
                              <span
                                className="port-dot"
                                style={{ background: portColor(output.kind) }}
                                data-port-key={`${node.id}:${output.id}:output`}
                                data-port-color={portColor(output.kind)}
                              />
                            </button>
                          ) : (
                            <span />
                          )}
                        </div>
                      </div>
                    );
                    })}
                  </div>

                  {nodeVisibleFields.length ? (
                    <div className="node-fields">
                      {nodeVisibleFields.map((field) => {
                      const value = node.config[field.key] ?? field.defaultValue;
                      const numberFieldKey = getNumberFieldKey(node.id, field.key);
                      const numberInputValue =
                        field.type === "number" && numberFieldKey in editingNumberFields
                          ? editingNumberFields[numberFieldKey]
                          : String(value);

                      return (
                        <label
                          key={field.key}
                          className={`node-field ${field.type === "checkbox" ? "is-checkbox" : ""}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          {field.type === "checkbox" ? (
                            <span className="node-checkbox-control">
                              <input
                                type="checkbox"
                                checked={Boolean(value)}
                                onChange={(event) => onUpdateNodeConfig(node.id, field.key, event.target.checked)}
                              />
                              <span className="node-field-label">{field.label}</span>
                            </span>
                          ) : field.type === "select" ? (
                            <>
                              <span className="node-field-label">{field.label}</span>
                            <select
                              value={String(value)}
                              onChange={(event) => onUpdateNodeConfig(node.id, field.key, event.target.value)}
                            >
                              {field.options?.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            </>
                          ) : (
                            <>
                              <span className="node-field-label-row">
                                <span className="node-field-label">{field.label}</span>
                                {field.helpText ? (
                                  <span className="node-help">
                                    <button
                                      type="button"
                                      className="node-help-button"
                                      tabIndex={-1}
                                      aria-label={`${field.label} help`}
                                      onPointerEnter={(event) => {
                                        const rect = event.currentTarget.getBoundingClientRect();
                                        setHoveredHelpTooltip({
                                          text: field.helpText ?? "",
                                          x: rect.left,
                                          y: rect.top - 8,
                                        });
                                      }}
                                      onPointerLeave={() => setHoveredHelpTooltip(null)}
                                      onPointerDown={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setHoveredHelpTooltip(null);
                                      }}
                                    >
                                      ?
                                    </button>
                                  </span>
                                ) : null}
                              </span>
                              <span className="node-field-input-row">
                                <input
                                  type={field.type === "number" ? "number" : "text"}
                                  step={field.type === "number" ? "any" : undefined}
                                  value={field.type === "number" ? numberInputValue : String(value)}
                                  onFocus={(event) => {
                                    if (field.type !== "number") {
                                      return;
                                    }

                                    setEditingNumberFields((current) => ({
                                      ...current,
                                      [numberFieldKey]: event.target.value,
                                    }));
                                  }}
                                  onChange={(event) => {
                                    if (field.type === "number") {
                                      const nextRaw = event.target.value;
                                      setEditingNumberFields((current) => ({
                                        ...current,
                                        [numberFieldKey]: nextRaw,
                                      }));

                                      if (
                                        nextRaw === "" ||
                                        nextRaw === "-" ||
                                        nextRaw === "." ||
                                        nextRaw === "-." ||
                                        nextRaw.endsWith(".")
                                      ) {
                                        return;
                                      }

                                      const parsed = Number(nextRaw);
                                      if (Number.isFinite(parsed)) {
                                        onUpdateNodeConfig(node.id, field.key, parsed);
                                      }
                                      return;
                                    }

                                    onUpdateNodeConfig(node.id, field.key, event.target.value);
                                  }}
                                  onBlur={() => {
                                    if (field.type !== "number") {
                                      return;
                                    }

                                    const rawValue = editingNumberFields[numberFieldKey];
                                    if (rawValue !== undefined) {
                                      const parsed = Number(rawValue);
                                      if (rawValue !== "" && Number.isFinite(parsed)) {
                                        onUpdateNodeConfig(node.id, field.key, parsed);
                                      }
                                    }

                                    setEditingNumberFields((current) => {
                                      if (!(numberFieldKey in current)) {
                                        return current;
                                      }

                                      const next = { ...current };
                                      delete next[numberFieldKey];
                                      return next;
                                    });
                                  }}
                                />
                              </span>
                            </>
                          )}
                        </label>
                      );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}

          {edges.map((edge) => {
            const hover = hoveredEdgeDistances.get(edge.id);
            if (!hover) {
              return null;
            }

            return (
              <button
                key={`${edge.id}-delete`}
                type="button"
                className="edge-delete-button"
                style={{
                  left: `${WORLD_ORIGIN + hover.x}px`,
                  top: `${WORLD_ORIGIN + hover.y}px`,
                  opacity: hoveredDeleteEdgeId === edge.id ? 1 : hover.opacity,
                  pointerEvents: hover.opacity > 0.2 || hoveredDeleteEdgeId === edge.id ? "auto" : "none",
                }}
                onPointerEnter={() => setHoveredDeleteEdgeId(edge.id)}
                onPointerLeave={() => setHoveredDeleteEdgeId((current) => (current === edge.id ? null : current))}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  onRemoveEdge(edge.id);
                }}
                aria-label="Delete connection"
              >
                ×
              </button>
            );
          })}
        </div>

        {pendingConnection ? (
          <button
            type="button"
            className="pending-connection-pill"
            onClick={(event) => {
              event.stopPropagation();
              onClearPendingConnection();
            }}
          >
            Connecting from {pendingConnection.nodeId}
          </button>
        ) : null}

        {selectionBox ? (
          <div
            className="selection-box"
            style={{
              left: `${camera.x + (WORLD_ORIGIN + Math.min(selectionBox.startX, selectionBox.endX)) * camera.zoom}px`,
              top: `${camera.y + (WORLD_ORIGIN + Math.min(selectionBox.startY, selectionBox.endY)) * camera.zoom}px`,
              width: `${Math.abs(selectionBox.endX - selectionBox.startX) * camera.zoom}px`,
              height: `${Math.abs(selectionBox.endY - selectionBox.startY) * camera.zoom}px`,
            }}
          />
        ) : null}

        {hoveredHelpTooltip ? (
          <div
            className="node-help-tooltip-overlay"
            style={{
              left: `${hoveredHelpTooltip.x}px`,
              top: `${hoveredHelpTooltip.y}px`,
            }}
          >
            {hoveredHelpTooltip.text}
          </div>
        ) : null}

        <div className="canvas-fab-stack">
          <button
            type="button"
            className="canvas-fab auto-align-fab"
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              onAutoAlign();
            }}
            title="Auto Align"
            aria-label="Auto Align"
          >
            <RectangleGroupIcon className="control-icon" />
          </button>

          <button
            type="button"
            className="canvas-fab auto-align-fab"
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              recenterCamera();
            }}
            title="Recenter Camera"
            aria-label="Recenter Camera"
          >
            <VideoCameraIcon className="control-icon" />
          </button>

          <button
            type="button"
            className={`canvas-fab auto-align-fab ${isGridSnapEnabled ? "is-secondary-active" : ""}`}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              onToggleGridSnap();
            }}
            title="Toggle Grid Snapping"
            aria-label="Toggle Grid Snapping"
            aria-pressed={isGridSnapEnabled}
          >
            <Squares2X2Icon className="control-icon" />
          </button>
        </div>

        <button
          type="button"
          className={`run-button ${isRunningBacktest ? "is-running" : ""}`}
          onPointerDown={(event) => {
            event.stopPropagation();
            event.preventDefault();
            onRun();
          }}
          title="Run Backtest"
          aria-label="Run Backtest"
        >
          <PlayIcon className="control-icon" />
        </button>

        {backtestResult ? (
          <button
            type="button"
            className={`results-toggle-button ${isResultsCollapsed ? "is-collapsed" : ""}`}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              setIsResultsCollapsed((current) => !current);
            }}
            title={isResultsCollapsed ? "Show Results" : "Hide Results"}
            aria-label={isResultsCollapsed ? "Show Results" : "Hide Results"}
          >
            {isResultsCollapsed ? <ChevronUpIcon className="control-icon" /> : <ChevronDownIcon className="control-icon" />}
          </button>
        ) : null}

      </div>
      {backtestResult ? (
        <div
          className={`results-shell ${isResultsCollapsed ? "is-collapsed" : ""} ${isResultsResizing ? "is-resizing" : ""}`}
          style={{ height: isResultsCollapsed ? "0px" : `${resultsHeight}px` }}
        >
          {isResultsCollapsed ? null : (
            <>
              <button
                type="button"
                className="results-resize-handle"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  hasUserSizedResultsRef.current = true;
                  setIsResultsResizing(true);
                  const viewportHeight = viewportRef.current?.clientHeight ?? window.innerHeight;
                  const minHeight = preferredResultsHeight ?? 260;
                  resizeResultsRef.current = {
                    startY: event.clientY,
                    startHeight: resultsHeight,
                    minHeight,
                    maxHeight: Math.max(minHeight, Math.floor(viewportHeight * 0.7)),
                  };
                  try {
                    viewportRef.current?.setPointerCapture(event.pointerId);
                  } catch {
                    // Ignore capture failures.
                  }
                }}
                aria-label="Resize results panel"
              />
              <ResultsPanel
                result={backtestResult}
                selectedPreviews={selectedPreviewEdgeIds
                  .map((edgeId) => backtestResult.previewSeriesByEdgeId[edgeId] ?? null)
                  .filter((preview): preview is NonNullable<typeof preview> => preview !== null)}
                onPreferredHeightChange={(height) => {
                  const viewportHeight = viewportRef.current?.clientHeight ?? window.innerHeight;
                  const maxHeight = Math.floor(viewportHeight * 0.7);
                  const nextHeight = Math.min(height, maxHeight);
                  setPreferredResultsHeight(nextHeight);
                  if (!hasUserSizedResultsRef.current) {
                    setResultsHeight(nextHeight);
                  }
                }}
              />
            </>
          )}
        </div>
      ) : null}
      {menuState ? (
        <div
          ref={contextMenuRef}
          className="context-menu context-menu-overlay"
          style={{ left: `${menuState.screenX}px`, top: `${menuState.screenY}px` }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="context-menu-viewport">
            <div
              className={`context-menu-track ${menuCategory ? "is-showing-nodes" : ""}`}
            >
              <div className="context-menu-panel">
                <div className="context-menu-title">Add Node</div>
                {Object.keys(groupedDefinitions).map((category) => (
                  <button
                    key={category}
                    type="button"
                    className="context-menu-item"
                    onClick={() => setMenuCategory(category)}
                  >
                    {category}
                  </button>
                ))}
              </div>

              <div className="context-menu-panel">
                <button type="button" className="context-menu-back" onClick={() => setMenuCategory(null)}>
                  ← Add Node
                </button>
                {(menuCategory ? groupedDefinitions[menuCategory] ?? [] : []).map((definition) => (
                  <button
                    key={definition.type}
                    type="button"
                    className="context-menu-item"
                    onClick={() => {
                      onAddNode(definition.type, menuState.worldX, menuState.worldY);
                      setMenuState(null);
                      setMenuCategory(null);
                    }}
                  >
                    {definition.title}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
