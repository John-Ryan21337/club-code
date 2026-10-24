import { ArrowLeftIcon, ArrowRightIcon, Maximize2Icon, XIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { useUiLocalization } from "../uiLocalization";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

function TableViewport({
  tableProps,
  expand,
  isStreaming,
}: {
  tableProps: ComponentProps<"table">;
  expand?: boolean;
  isStreaming?: boolean;
}) {
  const { t } = useUiLocalization();
  const viewport = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
  const [columnWidths, setColumnWidths] = useState<ReadonlyArray<number>>([]);
  const retainColumns = isStreaming === true || columnWidths.length > 0;
  useLayoutEffect(() => {
    const node = table.current;
    if (!isStreaming || columnWidths.length > 0 || !node?.tHead?.rows[0]) return;
    // Freeze the first visible column layout before paint. Later cells wrap in
    // their own column instead of repeatedly moving all earlier rows. Keep the
    // widths at completion too, so the last token does not cause another jump.
    setColumnWidths(
      Array.from(node.tHead.rows[0].cells, (cell) => cell.getBoundingClientRect().width),
    );
  }, [columnWidths.length, isStreaming, tableProps.children]);
  const [edges, setEdges] = useState({ overflow: false, left: false, right: false });
  const measure = useCallback(() => {
    const node = viewport.current;
    if (!node) return;
    const max = node.scrollWidth - node.clientWidth;
    const next = { overflow: max > 1, left: node.scrollLeft > 1, right: node.scrollLeft < max - 1 };
    setEdges((old) =>
      old.overflow === next.overflow && old.left === next.left && old.right === next.right
        ? old
        : next,
    );
  }, []);
  useEffect(() => {
    const node = viewport.current;
    const content = table.current;
    if (!node || !content) return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, [measure]);
  const scroll = (direction: number) => {
    const node = viewport.current;
    // Retain 29.3% of the previous view to keep column context while paging.
    node?.scrollBy({ left: (direction * node.clientWidth) / Math.SQRT2, behavior: "instant" });
  };
  return (
    <div
      className={`chat-markdown-table-frame ${expand ? "chat-markdown-table-expanded" : ""} ${retainColumns ? "chat-markdown-table-stable" : ""}`}
    >
      {edges.overflow && (
        <div className="chat-markdown-table-toolbar">
          <span className="text-xs text-muted-foreground">
            {t("Scroll table", "表をスクロール")}
          </span>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("Scroll table left", "表を左にスクロール")}
              disabled={!edges.left}
              onClick={() => scroll(-1)}
            >
              <ArrowLeftIcon className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("Scroll table right", "表を右にスクロール")}
              disabled={!edges.right}
              onClick={() => scroll(1)}
            >
              <ArrowRightIcon className="size-4" />
            </Button>
            {!expand && (
              <DialogTrigger
                render={
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-auto min-h-8 max-w-full whitespace-normal"
                  />
                }
              >
                <Maximize2Icon className="size-3.5 shrink-0" />
                {t("Expand table", "表を拡大")}
              </DialogTrigger>
            )}
          </div>
        </div>
      )}
      <div
        ref={viewport}
        className="chat-markdown-table-scroll"
        role={edges.overflow || expand ? "region" : undefined}
        tabIndex={edges.overflow || expand ? 0 : undefined}
        aria-label={
          edges.overflow || expand ? t("Scrollable table", "スクロールできる表") : undefined
        }
        onScroll={measure}
      >
        <table
          {...tableProps}
          ref={table}
          style={
            columnWidths.length > 0
              ? {
                  ...tableProps.style,
                  tableLayout: "fixed",
                  width: columnWidths.reduce((sum, width) => sum + width, 0),
                }
              : tableProps.style
          }
        >
          {columnWidths.length > 0 && (
            <colgroup>
              {columnWidths.map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
            </colgroup>
          )}
          {tableProps.children}
        </table>
      </div>
    </div>
  );
}

export function ChatMarkdownTable({
  isStreaming = false,
  ...props
}: ComponentProps<"table"> & { isStreaming?: boolean }) {
  const { t } = useUiLocalization();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <TableViewport tableProps={props} isStreaming={isStreaming} />
      <DialogPopup
        className="max-w-[min(96rem,calc(100vw-2rem))] max-h-[85dvh]"
        bottomStickOnMobile={false}
        showCloseButton={false}
      >
        <DialogHeader className="pr-14">
          <DialogTitle>{t("Expanded table", "拡大した表")}</DialogTitle>
          <DialogDescription>
            {t(
              "Scroll within the table to see all rows and columns.",
              "表の中をスクロールして、すべての行と列を表示できます。",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogClose
          render={
            <Button type="button" size="icon" variant="ghost" className="absolute right-2 top-2" />
          }
          aria-label={t("Close expanded table", "拡大した表を閉じる")}
        >
          <XIcon className="size-4" />
        </DialogClose>
        <div className="chat-markdown min-h-0 flex flex-col px-4 pb-4">
          {open && <TableViewport tableProps={props} isStreaming={isStreaming} expand />}
        </div>
      </DialogPopup>
    </Dialog>
  );
}
