'use client';
import { useEffect, useRef } from 'react';
import { formatScientificText, scientificRuns } from '@/lib/citation';

function serialize(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  const text = [...node.childNodes].map(serialize).join('');
  if (!(node instanceof HTMLElement)) return text;
  if (node.tagName === 'SUB' || node.style.verticalAlign === 'sub') return `_{${text}}`;
  if (node.tagName === 'SUP' || node.style.verticalAlign === 'super') return `^{${text}}`;
  return text;
}

export function TitleEditor({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const lastValue = useRef<string | null>(null);
  useEffect(() => {
    const element = editor.current;
    if (!element || value === lastValue.current) return;
    element.replaceChildren(
      ...scientificRuns(formatScientificText(value)).map((run) => {
        const node = document.createElement(
          run.script === 'sub' ? 'sub' : run.script === 'sup' ? 'sup' : 'span',
        );
        node.textContent = run.text;
        return node;
      }),
    );
    lastValue.current = value;
  }, [value]);
  function changed() {
    if (!editor.current) return;
    const text = serialize(editor.current);
    lastValue.current = text;
    onChange(text);
  }
  function toggle(command: 'subscript' | 'superscript') {
    const selection = window.getSelection();
    if (
      !editor.current ||
      !selection?.rangeCount ||
      selection.isCollapsed ||
      !editor.current.contains(selection.getRangeAt(0).commonAncestorContainer)
    )
      return;
    const element = editor.current;
    const selected = selection.getRangeAt(0);
    const prefix = selected.cloneRange();
    prefix.selectNodeContents(element);
    prefix.setEnd(selected.startContainer, selected.startOffset);
    const start = prefix.toString().length,
      end = start + selected.toString().length;
    const characters = scientificRuns(serialize(element)).flatMap((run) =>
      run.text.split('').map((text) => ({ text, script: run.script })),
    );
    const target = command === 'subscript' ? 'sub' : 'sup';
    const remove = characters.slice(start, end).every((run) => run.script === target);
    for (let index = start; index < end; index++)
      characters[index].script = remove ? 'normal' : target;
    element.replaceChildren(
      ...characters.map((run) => {
        const node = document.createElement(
          run.script === 'sub' ? 'sub' : run.script === 'sup' ? 'sup' : 'span',
        );
        node.textContent = run.text;
        return node;
      }),
    );
    element.focus();
    const nodes = [...element.childNodes];
    const range = document.createRange();
    range.setStart(nodes[start].firstChild!, 0);
    range.setEnd(nodes[end - 1].firstChild!, 1);
    selection.removeAllRanges();
    selection.addRange(range);
    changed();
  }
  return (
    <>
      <label id="reference-title-label">文献标题</label>
      <span className="citation-script-actions">
        <button
          type="button"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => toggle('superscript')}
        >
          上标 x²
        </button>
        <button
          type="button"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => toggle('subscript')}
        >
          下标 x₂
        </button>
      </span>
      <div
        ref={editor}
        role="textbox"
        aria-labelledby="reference-title-label"
        aria-multiline="false"
        className="text-input citation-title-editor"
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={changed}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault();
        }}
        onPaste={(event) => {
          event.preventDefault();
          document.execCommand(
            'insertText',
            false,
            event.clipboardData.getData('text/plain').replace(/[\r\n]+/g, ' '),
          );
          changed();
        }}
      />
    </>
  );
}
