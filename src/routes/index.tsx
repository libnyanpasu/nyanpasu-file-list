import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon, FolderIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { filesize } from "filesize";
import { formatDate } from "@/utils/fmt";
import { getFileList } from "@/query/files";
import { getFolderBreadcrumb } from "@/query/folders";
import { cn } from "@/lib/utils";

function getPageNumbers(
  current: number,
  total: number,
): (number | "ellipsis")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | "ellipsis")[] = [1];

  if (current > 3) {
    pages.push("ellipsis");
  }

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 2) {
    pages.push("ellipsis");
  }

  pages.push(total);

  return pages;
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => ({
    page: Number(search.page) || 1,
    folderId: (search.folderId as string) || null,
  }),
  loaderDeps: ({ search }) => ({
    page: search.page,
    folderId: search.folderId,
  }),
  loader: async ({ deps }) => {
    const [fileList, breadcrumb] = await Promise.all([
      getFileList({
        data: {
          page: deps.page,
          pageSize: 20,
          folderId: deps.folderId,
        },
      }),
      getFolderBreadcrumb({
        data: { folderId: deps.folderId },
      }),
    ]);

    return { ...fileList, breadcrumb };
  },
  component: Home,
});

function Home() {
  const { files, folders, total, page, totalPages, breadcrumb } =
    Route.useLoaderData();
  const { folderId } = Route.useSearch();

  const navigate = useNavigate();

  const goToPage = (p: number) => {
    navigate({ to: "/", search: { page: p, folderId } });
  };

  const goToFolder = (id: string | null) => {
    navigate({ to: "/", search: { page: 1, folderId: id } });
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Clash Nyanpasu File List</h1>

        <Badge variant="secondary">{total} files</Badge>
      </div>

      {/* Breadcrumb navigation */}
      <nav className="mb-4 flex items-center gap-1 text-sm">
        <button
          type="button"
          onClick={() => goToFolder(null)}
          className={cn(
            "hover:underline",
            folderId === null ? "font-semibold" : "text-muted-foreground",
          )}
        >
          Root
        </button>

        {breadcrumb.map((crumb) => (
          <span key={crumb.id} className="flex items-center gap-1">
            <ChevronRightIcon className="h-3 w-3 text-muted-foreground" />
            <button
              type="button"
              onClick={() => goToFolder(crumb.id)}
              className={cn(
                "hover:underline",
                crumb.id === folderId
                  ? "font-semibold"
                  : "text-muted-foreground",
              )}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File Name</TableHead>

              <TableHead className="w-28">Size</TableHead>

              <TableHead className="w-44">Upload Time</TableHead>

              <TableHead className="w-20 text-center">Link</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {folders.map((folder) => (
              <TableRow
                key={`folder-${folder.id}`}
                className="cursor-pointer"
                onClick={() => goToFolder(folder.id)}
              >
                <TableCell className="max-w-xs truncate font-medium">
                  <span className="flex items-center gap-2">
                    <FolderIcon className="h-4 w-4 text-muted-foreground" />
                    {folder.name}
                  </span>
                </TableCell>

                <TableCell className="text-muted-foreground">&mdash;</TableCell>

                <TableCell className="text-muted-foreground">
                  {formatDate(folder.created_at)}
                </TableCell>

                <TableCell />
              </TableRow>
            ))}

            {files.length === 0 && folders.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-24 text-center text-muted-foreground"
                >
                  No files found.
                </TableCell>
              </TableRow>
            ) : (
              files.map((file) => (
                <TableRow key={file.id}>
                  <TableCell className="max-w-xs truncate font-medium">
                    {file.file_name}
                  </TableCell>

                  <TableCell className="text-muted-foreground">
                    {filesize(file.file_size)}
                  </TableCell>

                  <TableCell>{formatDate(file.created_at)}</TableCell>

                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      render={
                        <Link
                          to="/bin/$id"
                          params={{
                            id: file.id,
                          }}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLinkIcon />
                        </Link>
                      }
                    >
                      <ExternalLinkIcon />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="mt-6">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => goToPage(Math.max(1, page - 1))}
                  className={
                    page <= 1
                      ? "pointer-events-none opacity-50"
                      : "cursor-pointer"
                  }
                />
              </PaginationItem>

              {getPageNumbers(page, totalPages).map((p, i) =>
                p === "ellipsis" ? (
                  <PaginationItem key={`ellipsis-${i}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={p}>
                    <PaginationLink
                      isActive={p === page}
                      onClick={() => goToPage(p)}
                      className="cursor-pointer"
                    >
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                ),
              )}

              <PaginationItem>
                <PaginationNext
                  onClick={() => goToPage(Math.min(totalPages, page + 1))}
                  className={
                    page >= totalPages
                      ? "pointer-events-none opacity-50"
                      : "cursor-pointer"
                  }
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}
