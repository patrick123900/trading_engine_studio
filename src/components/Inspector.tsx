import type { GraphNode, NodeDefinition } from "../core/types";

interface InspectorProps {
  node: GraphNode | undefined;
  definition: NodeDefinition | undefined;
  onUpdateConfig: (nodeId: string, key: string, value: string | number) => void;
  onDeleteNode: (nodeId: string) => void;
}

export function Inspector({ node, definition, onUpdateConfig, onDeleteNode }: InspectorProps) {
  if (!node || !definition) {
    return (
      <aside className="panel inspector">
        <div className="panel-header">
          <span className="eyebrow">Inspector</span>
          <h2>Select a node</h2>
        </div>
        <p className="muted">Choose a node on the canvas to edit configuration, inspect ports, or remove it from the graph.</p>
      </aside>
    );
  }

  return (
    <aside className="panel inspector">
      <div className="panel-header">
        <span className="eyebrow">Inspector</span>
        <h2>{definition.title}</h2>
      </div>

      <p className="muted">{definition.description}</p>

      <section className="inspector-block">
        <h3>Configuration</h3>
        <div className="field-list">
          {definition.fields.map((field) => {
            const value = node.config[field.key] ?? field.defaultValue;

            return (
              <div key={field.key} className="field-editor">
                <label htmlFor={`${node.id}-${field.key}`}>{field.label}</label>
                {field.type === "select" ? (
                  <select
                    id={`${node.id}-${field.key}`}
                    value={String(value)}
                    onChange={(event) => onUpdateConfig(node.id, field.key, event.target.value)}
                  >
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`${node.id}-${field.key}`}
                    type={field.type === "number" ? "number" : "text"}
                    value={String(value)}
                    onChange={(event) =>
                      onUpdateConfig(
                        node.id,
                        field.key,
                        field.type === "number" ? Number(event.target.value) : event.target.value,
                      )
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="inspector-block">
        <h3>Ports</h3>
        <div className="port-columns">
          <div>
            <h4>Inputs</h4>
            {definition.inputs.length === 0 ? <p className="muted">No inputs</p> : definition.inputs.map((port) => <p key={port.id}>{port.label}</p>)}
          </div>
          <div>
            <h4>Outputs</h4>
            {definition.outputs.length === 0 ? <p className="muted">No outputs</p> : definition.outputs.map((port) => <p key={port.id}>{port.label}</p>)}
          </div>
        </div>
      </section>

      <button type="button" className="danger-button" onClick={() => onDeleteNode(node.id)}>
        Delete Node
      </button>
    </aside>
  );
}
