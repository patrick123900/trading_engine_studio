import type { NodeDefinition } from "../core/types";

interface PaletteProps {
  definitions: NodeDefinition[];
}

export function Palette({ definitions }: PaletteProps) {
  const grouped = definitions.reduce<Record<string, NodeDefinition[]>>((acc, definition) => {
    acc[definition.category] ??= [];
    acc[definition.category].push(definition);
    return acc;
  }, {});

  return (
    <aside className="panel palette">
      <div className="panel-header">
        <span className="eyebrow">Node Library</span>
        <h2>Strategy Building Blocks</h2>
      </div>
      {Object.entries(grouped).map(([category, nodes]) => (
        <section key={category} className="palette-group">
          <h3>{category}</h3>
          <div className="palette-list">
            {nodes.map((node) => (
              <article key={node.type} className="palette-card">
                <span className="node-chip" style={{ background: node.color }} />
                <div>
                  <strong>{node.title}</strong>
                  <p>{node.description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </aside>
  );
}
