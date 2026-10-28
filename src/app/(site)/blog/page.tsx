import type { Metadata } from "next";
import Link from "next/link";
import { blogPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog",
  description: "Practical guides to digital services and account security.",
};

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-cream">
      <section className="py-16">
        <div className="shell text-center">
          <h1 className="text-[2.5rem] font-medium tracking-tight text-ink sm:text-[3rem]">Pryva Blog</h1>
          <p className="mx-auto mt-4 max-w-2xl text-[1.1rem] text-ink-2">
            Practical guides to digital services and account security.
          </p>
        </div>
      </section>
      <section className="pb-16">
        <div className="shell grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {blogPosts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="group rounded-2xl border border-line bg-white p-6 transition-shadow hover:shadow-[var(--shadow-card)]"
            >
              <span className="inline-block rounded-full bg-lav-100 px-3 py-1 text-[0.72rem] font-semibold text-lav-700">
                {post.category}
              </span>
              <h2 className="mb-3 mt-4 text-[1.1rem] font-semibold text-ink group-hover:text-lav-600">
                {post.title}
              </h2>
              <p className="text-[0.86rem] text-ink-2">{post.excerpt}</p>
              <span className="mt-5 inline-block text-sm font-semibold text-lav-700">Read guide →</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
