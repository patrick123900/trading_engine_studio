import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  MagnifyingGlassIcon,
  PlayIcon,
  RectangleGroupIcon,
  Squares2X2Icon,
  VideoCameraIcon,
} from "@heroicons/react/24/outline";
import type { BacktestResult, GraphCameraState, GraphEdge, GraphGroup, GraphNode, NodeDefinition } from "../core/types";
import { buildPortalInInputs, buildPortalOutOutputs, getPortalInChannels, getPortalOutChannels } from "../core/nodes/portalChannels";
import { ResultsPanel } from "./ResultsPanel";

interface CanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  groups: GraphGroup[];
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
  onAddGroup: (x: number, y: number) => void;
  onMoveGroup: (groupId: string, x: number, y: number, nodeIds: string[]) => void;
  onResizeGroup: (groupId: string, x: number, y: number, width: number, height: number) => void;
  onRenameGroup: (groupId: string, title: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onAddNode: (definitionType: string, x: number, y: number) => void;
  onStartConnection: (nodeId: string, portId: string) => void;
  onCompleteConnection: (nodeId: string, portId: string) => void;
  onRemoveEdge: (edgeId: string) => void;
  onClearPendingConnection: () => void;
  onUpdateNodeConfig: (nodeId: string, key: string, value: string | number | boolean | string[]) => void;
  onAddPortalOutChannel: (nodeId: string) => void;
  onUpdatePortalOutChannel: (nodeId: string, index: number, value: string) => void;
  onRemovePortalOutChannel: (nodeId: string, index: number) => void;
  onAddPortalInChannel: (nodeId: string) => void;
  onUpdatePortalInChannel: (nodeId: string, index: number, value: string) => void;
  onRemovePortalInChannel: (nodeId: string, index: number) => void;
  onRenameNode: (nodeId: string, title: string) => void;
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

interface DragPreviewState {
  nodeId: string;
  x: number;
  y: number;
}

interface GroupPreviewState {
  groupId: string;
  x: number;
  y: number;
}

interface GroupResizePreviewState {
  groupId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CursorWorldPoint {
  x: number;
  y: number;
}

function areCamerasEqual(left: GraphCameraState, right: GraphCameraState) {
  return left.x === right.x && left.y === right.y && left.zoom === right.zoom;
}

const NODE_WIDTH = 250;
const HEADER_HEIGHT = 38;
const GROUP_HEADER_HEIGHT = 38;
const FIELD_HEIGHT = 42;
const FIELD_GAP = 8;
const PORT_ROW_HEIGHT = 26;
const SIDE_PORT_INSET = 6;
const PORT_DOT_SIZE = 10;
const PORT_RADIUS = PORT_DOT_SIZE / 2;
const WORLD_SIZE = 50000;
const WORLD_ORIGIN = WORLD_SIZE / 2;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2.2;
const ZOOM_SLIDER_MIN = 0;
const ZOOM_SLIDER_MAX = 100;
const ZOOM_SLIDER_MID = 50;
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
  groups,
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
  onAddGroup,
  onMoveGroup,
  onResizeGroup,
  onRenameGroup,
  onDeleteGroup,
  onAddNode,
  onStartConnection,
  onCompleteConnection,
  onRemoveEdge,
  onClearPendingConnection,
  onUpdateNodeConfig,
  onAddPortalOutChannel,
  onUpdatePortalOutChannel,
  onRemovePortalOutChannel,
  onAddPortalInChannel,
  onUpdatePortalInChannel,
  onRemovePortalInChannel,
  onRenameNode,
  onDeleteNode,
  onRun,
  isRunningBacktest,
  executingNodeId,
  errorNodeId,
  backtestResult,
  selectedPreviewEdgeIds,
}: CanvasProps) {
  const definitionMap = useMemo(
    () => new Map(definitions.map((definition) => [definition.type, definition])),
    [definitions],
  );
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const graphLayerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    nodeId: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
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
  const [dragPreviewPoint, setDragPreviewPoint] = useState<{ x: number; y: number } | null>(null);
  const [cursorWorldPoint, setCursorWorldPoint] = useState<CursorWorldPoint | null>(null);
  const [hoveredDeleteEdgeId, setHoveredDeleteEdgeId] = useState<string | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [liveBoxSelectedNodeIds, setLiveBoxSelectedNodeIds] = useState<string[]>([]);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const [groupPreview, setGroupPreview] = useState<GroupPreviewState | null>(null);
  const [groupResizePreview, setGroupResizePreview] = useState<GroupResizePreviewState | null>(null);
  const [editingNumberFields, setEditingNumberFields] = useState<Record<string, string>>({});
  const [editingNodeTitle, setEditingNodeTitle] = useState<{ nodeId: string; value: string } | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [editingGroupTitle, setEditingGroupTitle] = useState<{ groupId: string; value: string } | null>(null);
  const groupTitleInputRef = useRef<HTMLInputElement | null>(null);
  const [hoveredHelpTooltip, setHoveredHelpTooltip] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const selectionBoxDragRef = useRef<{ pointerId: number; moved: boolean } | null>(null);
  const suppressNodeClickRef = useRef<string | null>(null);
  const suppressCanvasClickRef = useRef(false);
  const suppressNextNodeClickRef = useRef(false);
  const suppressNextNodeTitleClickRef = useRef(false);
  const suppressNextGroupTitleClickRef = useRef(false);
  const resizeResultsRef = useRef<{ startY: number; startHeight: number; maxHeight: number; minHeight: number } | null>(null);
  const previewPressRef = useRef<{ pointerId: number; outputKey: string; cancelled: boolean } | null>(null);
  const groupDragRef = useRef<{
    pointerId: number;
    groupId: string;
    offsetX: number;
    offsetY: number;
    nodeIds: string[];
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const groupResizeRef = useRef<{
    pointerId: number;
    groupId: string;
    handle: string;
    startWidth: number;
    startHeight: number;
    startGroupX: number;
    startGroupY: number;
    startX: number;
    startY: number;
  } | null>(null);

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
    (node.type === "trading.execution" &&
      (fieldKey === "positionPnlPercent" ||
        fieldKey === "longFillAnchor" ||
        fieldKey === "shortFillAnchor" ||
        fieldKey === "slippagePct" ||
        fieldKey === "commissionPct")) ||
    ((node.type === "utility.portalOut" || node.type === "utility.portalIn") && fieldKey === "channel");

  const getNodeInputs = (node: GraphNode, definition: NodeDefinition | undefined) => {
    if (node.type === "utility.portalIn") {
      return buildPortalInInputs(node.config);
    }

    return definition?.inputs ?? [];
  };

  const getNodeOutputs = (node: GraphNode, definition: NodeDefinition | undefined) => {
    if (node.type === "utility.portalOut") {
      return buildPortalOutOutputs(node.config);
    }

    return definition?.outputs ?? [];
  };

  const renderedFieldRowCount = (node: GraphNode, definition: NodeDefinition | undefined) => {
    if (!definition) {
      return 0;
    }

    const visibleFieldCount = definition.fields.filter((field) => !shouldHideField(node, field.key)).length;
    const hasCombinedFillAnchors =
      node.type === "trading.execution" &&
      definition.fields.some((field) => field.key === "longFillAnchor") &&
      definition.fields.some((field) => field.key === "shortFillAnchor");
    const hasCombinedSlipCommission =
      node.type === "trading.execution" &&
      definition.fields.some((field) => field.key === "slippagePct") &&
      definition.fields.some((field) => field.key === "commissionPct");

    return visibleFieldCount + (hasCombinedFillAnchors ? 1 : 0) + (hasCombinedSlipCommission ? 1 : 0);
  };

  const nodeHeight = (node: GraphNode, definition: NodeDefinition | undefined) => {
    if (!definition) {
      return 96;
    }

    const inputs = getNodeInputs(node, definition);
    const outputs = getNodeOutputs(node, definition);
    const portRows = Math.max(inputs.length, outputs.length, 1);
    const portsHeight = 14 + portRows * PORT_ROW_HEIGHT + 10;
    const visibleFieldCount = renderedFieldRowCount(node, definition);
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
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight)));
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

  const defaultZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, initialCamera.zoom));

  const zoomToSliderValue = (zoom: number) => {
    const clampedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    if (clampedZoom <= defaultZoom) {
      const denominator = Math.max(defaultZoom - MIN_ZOOM, Number.EPSILON);
      return ZOOM_SLIDER_MIN + ((clampedZoom - MIN_ZOOM) / denominator) * (ZOOM_SLIDER_MID - ZOOM_SLIDER_MIN);
    }

    const denominator = Math.max(MAX_ZOOM - defaultZoom, Number.EPSILON);
    return ZOOM_SLIDER_MID + ((clampedZoom - defaultZoom) / denominator) * (ZOOM_SLIDER_MAX - ZOOM_SLIDER_MID);
  };

  const sliderValueToZoom = (sliderValue: number) => {
    const clampedSlider = Math.min(ZOOM_SLIDER_MAX, Math.max(ZOOM_SLIDER_MIN, sliderValue));
    if (clampedSlider <= ZOOM_SLIDER_MID) {
      const ratio = (clampedSlider - ZOOM_SLIDER_MIN) / Math.max(ZOOM_SLIDER_MID - ZOOM_SLIDER_MIN, Number.EPSILON);
      return MIN_ZOOM + ratio * (defaultZoom - MIN_ZOOM);
    }

    const ratio = (clampedSlider - ZOOM_SLIDER_MID) / Math.max(ZOOM_SLIDER_MAX - ZOOM_SLIDER_MID, Number.EPSILON);
    return defaultZoom + ratio * (MAX_ZOOM - defaultZoom);
  };

  const setZoomAtViewportCenter = (nextZoom: number) => {
    setCamera((current) => {
      const clampedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
      const worldX = (canvasSize.width / 2 - current.x) / current.zoom;
      const worldY = (canvasSize.height / 2 - current.y) / current.zoom;
      const nextCamera = clampCamera(
        {
          zoom: clampedZoom,
          x: canvasSize.width / 2 - worldX * clampedZoom,
          y: canvasSize.height / 2 - worldY * clampedZoom,
        },
        canvasSize,
      );
      cameraRef.current = nextCamera;
      return nextCamera;
    });
  };

  const handleZoomSliderChange = (rawValue: number) => {
    const snapThreshold = 4;
    const snappedValue = Math.abs(rawValue - ZOOM_SLIDER_MID) <= snapThreshold ? ZOOM_SLIDER_MID : rawValue;
    setZoomAtViewportCenter(sliderValueToZoom(snappedValue));
  };

  const visibleFields = (node: GraphNode, definition: NodeDefinition | undefined) => {
    if (!definition) {
      return [];
    }

    return definition.fields.filter((field) => !shouldHideField(node, field.key));
  };

  const getNumberFieldKey = (nodeId: string, fieldKey: string) => `${nodeId}:${fieldKey}`;

  const displayedNodes = useMemo(() => {
    if (!dragPreview) {
      return nodes;
    }

    const anchorNode = nodes.find((node) => node.id === dragPreview.nodeId);
    if (!anchorNode) {
      return nodes;
    }

    const selectedSet = new Set(selectedNodeIds.includes(dragPreview.nodeId) ? selectedNodeIds : [dragPreview.nodeId]);
    const deltaX = dragPreview.x - anchorNode.position.x;
    const deltaY = dragPreview.y - anchorNode.position.y;

    return nodes.map((node) =>
      selectedSet.has(node.id)
        ? {
            ...node,
            position: {
              x: node.position.x + deltaX,
              y: node.position.y + deltaY,
            },
          }
        : node,
    );
  }, [dragPreview, nodes, selectedNodeIds]);

  const displayedGroups = useMemo(
    () =>
      groups.map((group) => {
        if (groupResizePreview?.groupId === group.id) {
          return {
            ...group,
            position: { x: groupResizePreview.x, y: groupResizePreview.y },
            size: {
              width: groupResizePreview.width,
              height: groupResizePreview.height,
            },
          };
        }

        if (groupPreview?.groupId === group.id) {
          return {
            ...group,
            position: { x: groupPreview.x, y: groupPreview.y },
          };
        }

        return group;
      }),
    [groupPreview, groupResizePreview, groups],
  );

  const portPositions = useMemo(() => {
    const nextPositions: Record<string, PortPosition> = {};

    for (const node of displayedNodes) {
      const definition = definitionMap.get(node.type);
      const inputs = getNodeInputs(node, definition);
      const outputs = getNodeOutputs(node, definition);

      inputs.forEach((port, index) => {
        nextPositions[`${node.id}:${port.id}:input`] = {
          x: WORLD_ORIGIN + node.position.x + SIDE_PORT_INSET + PORT_RADIUS,
          y: WORLD_ORIGIN + node.position.y + getPortY(definition, index),
          color: portColor(port.kind),
        };
      });

      outputs.forEach((port, index) => {
        nextPositions[`${node.id}:${port.id}:output`] = {
          x: WORLD_ORIGIN + node.position.x + NODE_WIDTH - SIDE_PORT_INSET - PORT_RADIUS,
          y: WORLD_ORIGIN + node.position.y + getPortY(definition, index),
          color: portColor(port.kind),
        };
      });
    }

    return nextPositions;
  }, [definitionMap, displayedNodes]);

  const commitNodeTitle = (nodeId: string, fallbackTitle: string) => {
    if (!editingNodeTitle || editingNodeTitle.nodeId !== nodeId) {
      return;
    }

    const trimmed = editingNodeTitle.value.trim();
    onRenameNode(nodeId, trimmed || fallbackTitle);
    setEditingNodeTitle(null);
  };

  const commitGroupTitle = (groupId: string, fallbackTitle: string) => {
    if (!editingGroupTitle || editingGroupTitle.groupId !== groupId) {
      return;
    }

    const trimmed = editingGroupTitle.value.trim();
    onRenameGroup(groupId, trimmed || fallbackTitle);
    setEditingGroupTitle(null);
  };

  const getNodesInsideGroup = (group: GraphGroup) =>
    displayedNodes
      .filter((node) => {
        const definition = definitionMap.get(node.type);
        const height = nodeHeight(node, definition);
        const left = node.position.x;
        const top = node.position.y;
        const right = left + NODE_WIDTH;
        const bottom = top + height;
        return (
          left >= group.position.x &&
          top >= group.position.y + GROUP_HEADER_HEIGHT &&
          right <= group.position.x + group.size.width &&
          bottom <= group.position.y + group.size.height
        );
      })
      .map((node) => node.id);

  useEffect(() => {
    if (!editingNodeTitle) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (titleInputRef.current?.contains(event.target as Node)) {
        return;
      }

      const activeNode = nodes.find((node) => node.id === editingNodeTitle.nodeId);
      commitNodeTitle(editingNodeTitle.nodeId, activeNode?.title ?? editingNodeTitle.value);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [editingNodeTitle, nodes]);

  useEffect(() => {
    if (!editingGroupTitle) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (groupTitleInputRef.current?.contains(event.target as Node)) {
        return;
      }

      const activeGroup = groups.find((group) => group.id === editingGroupTitle.groupId);
      commitGroupTitle(editingGroupTitle.groupId, activeGroup?.title ?? editingGroupTitle.value);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [editingGroupTitle, groups]);

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

    const node = displayedNodes.find((entry) => entry.id === nodeId);
    if (!node) {
      return null;
    }

    const definition = definitionMap.get(node.type);
    const ports = side === "input" ? getNodeInputs(node, definition) : getNodeOutputs(node, definition);
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
    groupDragRef.current = null;
    groupResizeRef.current = null;
    setDragPreviewPoint(null);
    setDragPreview(null);
    setGroupPreview(null);
    setGroupResizePreview(null);
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

    return displayedNodes
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
            event.target.closest(".node-card, .group-header, .group-delete, .group-resize-handle, .context-menu, .run-button, .pending-connection-pill, .canvas-fab, .zoom-slider-stack")
          ) {
            return;
          }

          if (event.button !== 0) {
            return;
          }

          if (event.ctrlKey || event.metaKey) {
            (document.activeElement as HTMLElement | null)?.blur();
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

          (document.activeElement as HTMLElement | null)?.blur();
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

          if (groupResizeRef.current && event.pointerId === groupResizeRef.current.pointerId) {
            const { handle, groupId, startGroupX, startGroupY, startWidth, startHeight, startX, startY } = groupResizeRef.current;
            const zoom = Math.max(camera.zoom, 0.0001);
            const rawDeltaX = (event.clientX - startX) / zoom;
            const rawDeltaY = (event.clientY - startY) / zoom;
            const snapVal = (v: number) => Math.round(v / 36) * 36;
            const eastEdge = startGroupX + startWidth;
            const southEdge = startGroupY + startHeight;
            const resizesEast = handle === "e" || handle === "ne" || handle === "se";
            const resizesWest = handle === "w" || handle === "nw" || handle === "sw";
            const resizesSouth = handle === "s" || handle === "se" || handle === "sw";
            const resizesNorth = handle === "n" || handle === "ne" || handle === "nw";
            let newWidth = startWidth;
            let newHeight = startHeight;
            let newX = startGroupX;
            let newY = startGroupY;
            if (resizesEast) {
              const raw = Math.max(220, startWidth + rawDeltaX);
              newWidth = isGridSnapEnabled ? Math.max(220, snapVal(raw)) : raw;
            } else if (resizesWest) {
              const raw = Math.max(220, startWidth - rawDeltaX);
              newWidth = isGridSnapEnabled ? Math.max(220, snapVal(raw)) : raw;
              newX = eastEdge - newWidth;
            }
            if (resizesSouth) {
              const raw = Math.max(140, startHeight + rawDeltaY);
              newHeight = isGridSnapEnabled ? Math.max(140, snapVal(raw)) : raw;
            } else if (resizesNorth) {
              const raw = Math.max(140, startHeight - rawDeltaY);
              newHeight = isGridSnapEnabled ? Math.max(140, snapVal(raw)) : raw;
              newY = southEdge - newHeight;
            }
            setGroupResizePreview({
              groupId,
              x: newX,
              y: newY,
              width: newWidth,
              height: newHeight,
            });
            return;
          }

          if (groupDragRef.current && event.pointerId === groupDragRef.current.pointerId) {
            if (!groupDragRef.current.moved) {
              const deltaX = event.clientX - groupDragRef.current.startX;
              const deltaY = event.clientY - groupDragRef.current.startY;
              if (Math.hypot(deltaX, deltaY) > 3) {
                groupDragRef.current.moved = true;
              }
            }
            const world = screenToWorld(event.clientX, event.clientY);
            setGroupPreview({
              groupId: groupDragRef.current.groupId,
              x: world.x - groupDragRef.current.offsetX,
              y: world.y - groupDragRef.current.offsetY,
            });
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
            setDragPreview({
              nodeId: dragStateRef.current.nodeId,
              x: world.x - dragStateRef.current.offsetX,
              y: world.y - dragStateRef.current.offsetY,
            });
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
          const activeGroupDrag = groupDragRef.current;
          const activeGroupResize = groupResizeRef.current;
          const nextGroupPreview = groupPreview;
          const nextGroupResizePreview = groupResizePreview;
          const nextDragPreview = dragPreview;
          const didMoveGroup = groupDragRef.current?.moved === true;
          setIsResultsResizing(false);
          previewPressRef.current = null;
          if (panStateRef.current?.moved) {
            suppressCanvasClickRef.current = true;
          }
          if (dragMoveStateRef.current?.moved) {
            suppressNextNodeClickRef.current = true;
            suppressNextNodeTitleClickRef.current = true;
          }
          if (didMoveGroup) {
            suppressNextGroupTitleClickRef.current = true;
          }

          if (activeGroupResize && nextGroupResizePreview) {
            onResizeGroup(
              nextGroupResizePreview.groupId,
              nextGroupResizePreview.x,
              nextGroupResizePreview.y,
              nextGroupResizePreview.width,
              nextGroupResizePreview.height,
            );
          }

          if (activeGroupDrag && didMoveGroup && nextGroupPreview) {
            onMoveGroup(
              nextGroupPreview.groupId,
              nextGroupPreview.x,
              nextGroupPreview.y,
              activeGroupDrag.nodeIds,
            );
          }

          if (dragMoveStateRef.current?.moved && nextDragPreview) {
            onMoveNode(nextDragPreview.nodeId, nextDragPreview.x, nextDragPreview.y);
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
          groupResizeRef.current = null;
          groupDragRef.current = null;
          stopAllInteractions();
        }}
        onPointerCancel={(event) => {
          resizeResultsRef.current = null;
          groupResizeRef.current = null;
          groupDragRef.current = null;
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
          groupResizeRef.current = null;
          groupDragRef.current = null;
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
            const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
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
          {displayedGroups.map((group) => (
            <div
              key={group.id}
              className="group-card"
              style={{
                left: `${WORLD_ORIGIN + group.position.x}px`,
                top: `${WORLD_ORIGIN + group.position.y}px`,
                width: `${group.size.width}px`,
                height: `${group.size.height}px`,
              }}
            >
              <div
                className="group-header"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  const world = screenToWorld(event.clientX, event.clientY);
                  groupDragRef.current = {
                    pointerId: event.pointerId,
                    groupId: group.id,
                    offsetX: world.x - group.position.x,
                    offsetY: world.y - group.position.y,
                    nodeIds: getNodesInsideGroup(group),
                    startX: event.clientX,
                    startY: event.clientY,
                    moved: false,
                  };
                }}
              >
                {editingGroupTitle?.groupId === group.id ? (
                  <input
                    ref={groupTitleInputRef}
                    className="group-title-input"
                    value={editingGroupTitle.value}
                    autoFocus
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      setEditingGroupTitle({
                        groupId: group.id,
                        value: event.target.value,
                      })
                    }
                    onBlur={() => commitGroupTitle(group.id, group.title)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitGroupTitle(group.id, group.title);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setEditingGroupTitle(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="group-title-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (suppressNextGroupTitleClickRef.current) {
                        suppressNextGroupTitleClickRef.current = false;
                        return;
                      }
                      setEditingGroupTitle({ groupId: group.id, value: group.title });
                    }}
                  >
                    {group.title}
                  </button>
                )}
                <button
                  type="button"
                  className="group-delete"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    onDeleteGroup(group.id);
                  }}
                >
                  ×
                </button>
              </div>
              {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map((handle) => (
                <div
                  key={handle}
                  className={`group-resize-handle group-resize-${handle}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    try {
                      viewportRef.current?.setPointerCapture(event.pointerId);
                    } catch {}
                    groupResizeRef.current = {
                      pointerId: event.pointerId,
                      groupId: group.id,
                      handle,
                      startWidth: group.size.width,
                      startHeight: group.size.height,
                      startGroupX: group.position.x,
                      startGroupY: group.position.y,
                      startX: event.clientX,
                      startY: event.clientY,
                    };
                  }}
                />
              ))}
            </div>
          ))}

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

          {displayedNodes.map((node) => {
            const definition = definitionMap.get(node.type);
            const height = nodeHeight(node, definition);
            const inputs = getNodeInputs(node, definition);
            const outputs = getNodeOutputs(node, definition);
            const portRows = Math.max(inputs.length, outputs.length, 1);
            const nodeVisibleFields = visibleFields(node, definition);
            const portalOutChannels = node.type === "utility.portalOut" ? getPortalOutChannels(node.config) : [];
            const portalInChannels = node.type === "utility.portalIn" ? getPortalInChannels(node.config) : [];
            const longFillField = definition?.fields.find((field) => field.key === "longFillAnchor");
            const shortFillField = definition?.fields.find((field) => field.key === "shortFillAnchor");
            const slippageField = definition?.fields.find((field) => field.key === "slippagePct");
            const commissionField = definition?.fields.find((field) => field.key === "commissionPct");

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
                    {editingNodeTitle?.nodeId === node.id ? (
                      <input
                        ref={titleInputRef}
                        className="node-header-title-input"
                        value={editingNodeTitle.value}
                        autoFocus
                        onPointerDown={(event) => {
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                        onChange={(event) =>
                          setEditingNodeTitle({
                            nodeId: node.id,
                            value: event.target.value,
                          })
                        }
                        onBlur={() => commitNodeTitle(node.id, node.title)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitNodeTitle(node.id, node.title);
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            setEditingNodeTitle(null);
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="node-header-title-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (suppressNextNodeTitleClickRef.current) {
                            suppressNextNodeTitleClickRef.current = false;
                            return;
                          }
                          setEditingNodeTitle({
                            nodeId: node.id,
                            value: node.title,
                          });
                        }}
                      >
                        <span className="node-header-title">{node.title}</span>
                      </button>
                    )}
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
                    const input = inputs[index];
                    const output = outputs[index];

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

                  {nodeVisibleFields.length || node.type === "utility.portalOut" || node.type === "utility.portalIn" ? (
                    <div className="node-fields">
                      {nodeVisibleFields.map((field) => {
                      const value = node.config[field.key] ?? field.defaultValue;
                      const isCloseSignalReverseField =
                        node.type === "output.signal" &&
                        field.key === "reversePosition" &&
                        String(node.config.side ?? "long").trim().toLowerCase() === "close";
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
                            <span className={`node-checkbox-control ${isCloseSignalReverseField ? "is-disabled" : ""}`}>
                              <input
                                type="checkbox"
                                checked={Boolean(value)}
                                disabled={isCloseSignalReverseField}
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
                      {node.type === "trading.execution" && longFillField && shortFillField ? (
                        <div className="node-field-row-grid">
                          {[longFillField, shortFillField].map((field) => {
                            const value = node.config[field.key] ?? field.defaultValue;

                            return (
                              <label
                                key={field.key}
                                className="node-field node-field-compact"
                                onClick={(event) => event.stopPropagation()}
                              >
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
                              </label>
                            );
                          })}
                        </div>
                      ) : null}
                      {node.type === "trading.execution" && slippageField && commissionField ? (
                        <div className="node-field-row-grid">
                          {[slippageField, commissionField].map((field) => {
                            const value = node.config[field.key] ?? field.defaultValue;
                            const numberFieldKey = getNumberFieldKey(node.id, field.key);
                            const numberInputValue =
                              numberFieldKey in editingNumberFields
                                ? editingNumberFields[numberFieldKey]
                                : String(value);

                            return (
                              <label
                                key={field.key}
                                className="node-field node-field-compact"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <span className="node-field-label">{field.label}</span>
                                <input
                                  type="number"
                                  step="any"
                                  value={numberInputValue}
                                  onFocus={(event) => {
                                    setEditingNumberFields((current) => ({
                                      ...current,
                                      [numberFieldKey]: event.target.value,
                                    }));
                                  }}
                                  onChange={(event) => {
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
                                  }}
                                  onBlur={() => {
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
                              </label>
                            );
                          })}
                        </div>
                      ) : null}
                      {node.type === "utility.portalOut" ? (
                        <div className="portal-channel-list" onClick={(event) => event.stopPropagation()}>
                          {portalOutChannels.map((channel, index) => (
                            <label key={`${node.id}-portal-channel-${index}`} className="node-field">
                              <span className="node-field-label-row">
                                <span className="node-field-label">Channel {index + 1}</span>
                                {index > 0 ? (
                                  <button
                                    type="button"
                                    className="portal-channel-delete"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onRemovePortalOutChannel(node.id, index);
                                    }}
                                  >
                                    ×
                                  </button>
                                ) : null}
                              </span>
                              <input
                                type="text"
                                value={channel}
                                onChange={(event) => onUpdatePortalOutChannel(node.id, index, event.target.value)}
                              />
                            </label>
                          ))}
                          <button
                            type="button"
                            className="portal-channel-add"
                            onClick={(event) => {
                              event.stopPropagation();
                              onAddPortalOutChannel(node.id);
                            }}
                            aria-label="Add channel output"
                          >
                            +
                          </button>
                        </div>
                      ) : null}
                      {node.type === "utility.portalIn" ? (
                        <div className="portal-channel-list" onClick={(event) => event.stopPropagation()}>
                          {portalInChannels.map((channel, index) => (
                            <label key={`${node.id}-portal-in-channel-${index}`} className="node-field">
                              <span className="node-field-label-row">
                                <span className="node-field-label">Channel {index + 1}</span>
                                {index > 0 ? (
                                  <button
                                    type="button"
                                    className="portal-channel-delete"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onRemovePortalInChannel(node.id, index);
                                    }}
                                  >
                                    ×
                                  </button>
                                ) : null}
                              </span>
                              <input
                                type="text"
                                value={channel}
                                onChange={(event) => onUpdatePortalInChannel(node.id, index, event.target.value)}
                              />
                            </label>
                          ))}
                          <button
                            type="button"
                            className="portal-channel-add"
                            onClick={(event) => {
                              event.stopPropagation();
                              onAddPortalInChannel(node.id);
                            }}
                            aria-label="Add channel input"
                          >
                            +
                          </button>
                        </div>
                      ) : null}
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

        <div
          className="zoom-slider-stack"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
        >
          <MagnifyingGlassIcon className="zoom-slider-icon" aria-hidden="true" />
          <div className="zoom-slider-track-wrap">
            <input
              type="range"
              className="zoom-slider"
              min={ZOOM_SLIDER_MIN}
              max={ZOOM_SLIDER_MAX}
              step={1}
              value={Math.round(zoomToSliderValue(camera.zoom))}
              onChange={(event) => {
                handleZoomSliderChange(Number(event.target.value));
              }}
              aria-label="Zoom"
            />
          </div>
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
                {menuCategory === "Utility" ? (
                  <button
                    type="button"
                    className="context-menu-item"
                    onClick={() => {
                      onAddGroup(menuState.worldX, menuState.worldY);
                      setMenuState(null);
                      setMenuCategory(null);
                    }}
                  >
                    Group
                  </button>
                ) : null}
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
