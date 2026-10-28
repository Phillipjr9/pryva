import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { blogPosts, getBlogPost } from "@/lib/blog";

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return blogPosts.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const post = getBlogPost((await params).slug);
  return post ? { title: post.title, description: post.excerpt } : { title: "Guide not found" };
}

export default async function BlogArticlePage({ params }: PageProps) {
  const post = getBlogPost((await params).slug);
  if (!post) notFound();

  return (
    <article className="bg-cream py-16">
      <div className="shell max-w-3xl">
        <Link href="/blog" className="text-sm font-semibold text-lav-700 hover:text-lav-600">← All guides</Link>
        <p className="mt-8 text-sm font-semibold text-lav-700">{post.category}</p>
        <h1 className="mt-3 text-4xl font-medium tracking-tight text-ink sm:text-5xl">{post.title}</h1>
        <p className="mt-5 text-lg text-ink-2">{post.excerpt}</p>
        <div className="mt-10 space-y-8 rounded-2xl border border-line bg-white p-6 sm:p-10">
          {post.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-xl font-semibold text-ink">{section.heading}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph} className="mt-3 leading-7 text-ink-2">{paragraph}</p>
              ))}
            </section>
          ))}
        </div>
        <p className="mt-8 text-sm text-ink-2">
          Questions about an existing order? <Link href="/contact" className="font-semibold text-lav-700">Contact support</Link>.
        </p>
      </div>
    </article>
  );
}
