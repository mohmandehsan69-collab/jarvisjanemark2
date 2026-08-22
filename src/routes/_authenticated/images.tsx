import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Download, ImageIcon, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Page, Empty, errorText } from "@/components/app/Page";
import { supabase } from "@/integrations/supabase/client";
import { generateImage } from "@/lib/jarvis.functions";
import { consumePendingInstruction } from "@/lib/voice-router";

const title = "Image generation";
const description =
  "Describe an image and Jarvis renders it. Every image is saved to your private gallery.";

export const Route = createFileRoute("/_authenticated/images")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ImagesPage,
});

function ImagesPage() {
  const [prompt, setPrompt] = useState("");
  const qc = useQueryClient();
  const gen = useServerFn(generateImage);
  const ranPending = useRef(false);

  const gallery = useQuery({
    queryKey: ["generated_images"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("generated_images")
        .select("id,prompt,image_data,mime_type,created_at")
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const create = useMutation({
    mutationFn: (p: string) => gen({ data: { prompt: p.trim() } }),
    onSuccess: () => {
      setPrompt("");
      void qc.invalidateQueries({ queryKey: ["generated_images"] });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  useEffect(() => {
    if (ranPending.current) return;
    ranPending.current = true;
    const pending = consumePendingInstruction();
    if (pending) {
      setPrompt(pending);
      create.mutate(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function download(row: { image_data: string; mime_type: string; prompt: string }) {
    const a = document.createElement("a");
    a.href = `data:${row.mime_type};base64,${row.image_data}`;
    a.download = `${
      row.prompt
        .slice(0, 40)
        .replace(/[^a-z0-9]+/gi, "-")
        .toLowerCase() || "image"
    }.png`;
    a.click();
  }

  return (
    <Page eyebrow="Creative" title="Image generation" intro={description} wide>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (prompt.trim()) create.mutate(prompt);
        }}
      >
        <Textarea
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="A hand-drawn map of a fantasy coastline, warm parchment tones, 4K detail…"
          className="flex-1"
        />
        <Button
          type="submit"
          disabled={create.isPending || !prompt.trim()}
          className="gap-2 self-start"
        >
          {create.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ImageIcon className="size-4" />
          )}
          Generate
        </Button>
      </form>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {gallery.isLoading ? <Empty>Loading…</Empty> : null}
        {gallery.data?.length === 0 ? <Empty>No images yet.</Empty> : null}
        {gallery.data?.map((row) => (
          <figure key={row.id} className="panel overflow-hidden p-0">
            <img
              src={`data:${row.mime_type};base64,${row.image_data}`}
              alt={row.prompt}
              className="aspect-square w-full object-cover"
            />
            <figcaption className="space-y-2 p-3">
              <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {row.prompt}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 gap-1.5"
                  onClick={() => setPrompt(row.prompt)}
                >
                  <RefreshCw className="size-3.5" /> Tweak
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => download(row)}
                  aria-label="Download"
                >
                  <Download className="size-3.5" />
                </Button>
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </Page>
  );
}
