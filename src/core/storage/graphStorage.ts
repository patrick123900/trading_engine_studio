import type { GraphCameraState, StrategyGraph } from "../types";

const STORAGE_KEY = "trading-engine-studio.graphs";

export interface StoredGraphDocument {
  name: string;
  graph: StrategyGraph;
  camera?: GraphCameraState;
  updatedAt: string;
}

interface GraphStorageRecord {
  documents: StoredGraphDocument[];
}

function readStorageRecord(): GraphStorageRecord {
  if (typeof window === "undefined") {
    return { documents: [] };
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { documents: [] };
  }

  try {
    const parsed = JSON.parse(raw) as GraphStorageRecord;
    return {
      documents: Array.isArray(parsed.documents) ? parsed.documents : [],
    };
  } catch {
    return { documents: [] };
  }
}

function writeStorageRecord(record: GraphStorageRecord) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}

export function listStoredGraphs() {
  return readStorageRecord().documents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveStoredGraph(name: string, graph: StrategyGraph, camera?: GraphCameraState) {
  const record = readStorageRecord();
  const nextDocument: StoredGraphDocument = {
    name,
    graph,
    camera,
    updatedAt: new Date().toISOString(),
  };

  const nextDocuments = record.documents.filter((document) => document.name !== name);
  nextDocuments.push(nextDocument);
  writeStorageRecord({ documents: nextDocuments });

  return nextDocument;
}

export function loadStoredGraph(name: string) {
  return readStorageRecord().documents.find((document) => document.name === name) ?? null;
}

export function renameStoredGraph(name: string, nextName: string) {
  const record = readStorageRecord();
  const existing = record.documents.find((document) => document.name === name);
  if (!existing) {
    return null;
  }

  const renamed: StoredGraphDocument = {
    ...existing,
    name: nextName,
    updatedAt: new Date().toISOString(),
  };

  const nextDocuments = record.documents.filter(
    (document) => document.name !== name && document.name !== nextName,
  );
  nextDocuments.push(renamed);
  writeStorageRecord({ documents: nextDocuments });
  return renamed;
}

export function deleteStoredGraph(name: string) {
  const record = readStorageRecord();
  const nextDocuments = record.documents.filter((document) => document.name !== name);

  if (nextDocuments.length === record.documents.length) {
    return false;
  }

  writeStorageRecord({ documents: nextDocuments });
  return true;
}
