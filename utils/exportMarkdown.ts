import { Entity, Relationship } from '../types';

export const exportToMarkdown = (
    entities: Entity[],
    relationships: Relationship[],
    options?: {
        kinds?: string[];
        includeCompleted?: boolean;
        title?: string;
    }
): string => {
    const { kinds, includeCompleted = true, title = 'Flowmate Export' } = options || {};

    // Filter entities
    let filtered = entities;
    if (kinds && kinds.length > 0) {
        filtered = filtered.filter(e => kinds.includes(e.kind));
    }
    if (!includeCompleted) {
        filtered = filtered.filter(e => e.status !== 'COMPLETED' && e.status !== 'ARCHIVED');
    }

    // Sort by kind, then by priority
    filtered.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
        return (b.priority || 0) - (a.priority || 0);
    });

    // Build Markdown
    let md = `# ${title}\n\n`;
    md += `_Exported on ${new Date().toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    })}_\n\n`;

    // Group by kind
    const grouped: Record<string, Entity[]> = {};
    filtered.forEach(e => {
        if (!grouped[e.kind]) grouped[e.kind] = [];
        grouped[e.kind].push(e);
    });

    // Render each group
    Object.keys(grouped).forEach(kind => {
        md += `## ${kind}s\n\n`;

        grouped[kind].forEach(e => {
            const checkbox = e.status === 'COMPLETED' ? '[x]' : '[ ]';
            const priority = e.priority > 3 ? '🔴' : e.priority > 1 ? '🟡' : '';
            const deadline = e.deadline ? ` (Due: ${new Date(e.deadline).toLocaleDateString()})` : '';

            md += `- ${checkbox} **${e.title}**${priority}${deadline}\n`;

            if (e.description) {
                md += `  > ${e.description.replace(/\n/g, '\n  > ')}\n`;
            }

            if (e.canonical_tags && e.canonical_tags.length > 0) {
                md += `  Tags: ${e.canonical_tags.map(t => `\`${t}\``).join(', ')}\n`;
            }

            md += `\n`;
        });
    });

    // Add relationships summary
    if (relationships.length > 0) {
        md += `---\n\n## Relationships\n\n`;
        md += `Total: ${relationships.length} connections\n\n`;
    }

    return md;
};

export const downloadMarkdown = (content: string, filename: string = 'flowmate-export.md') => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};
