import { Metadata } from "next";
import Link from "next/link";
import { Clock, User } from "@/components/icons";

export const metadata: Metadata = {
  title: "Blog",
  description: "Latest news, updates, and guides from Pryva.",
};

const posts = [
  {
    slug: "getting-started-virtual-numbers",
    title: "Getting Started with Virtual Numbers: A Complete Guide",
    excerpt: "Learn everything you need to know about virtual numbers, from choosing the right country to receiving your first SMS verification code.",
    author: "Pryva Team",
    date: "2024-01-15",
    readTime: "5 min read",
    category: "Guides",
  },
  {
    slug: "esim-travel-guide",
    title: "The Ultimate eSIM Travel Guide for 2024",
    excerpt: "Discover how eSIMs are revolutionizing international travel. Learn about compatible devices, activation process, and best practices.",
    author: "Pryva Team",
    date: "2024-01-10",
    readTime: "8 min read",
    category: "Travel",
  },
  {
    slug: "residential-proxies-explained",
    title: "Residential Proxies Explained: What They Are and Why You Need Them",
    excerpt: "Understanding residential proxies, their use cases, and how they differ from datacenter proxies for web scraping and ad verification.",
    author: "Pryva Team",
    date: "2024-01-05",
    readTime: "6 min read",
    category: "Technology",
  },
  {
    slug: "whatsapp-verification-tips",
    title: "5 Tips for Successful WhatsApp Verification",
    excerpt: "Having trouble verifying your WhatsApp account? Here are 5 proven tips to ensure your verification goes smoothly.",
    author: "Pryva Team",
    date: "2023-12-28",
    readTime: "4 min read",
    category: "Guides",
  },
  {
    slug: "gift-cards-for-teams",
    title: "How to Use Pryva Gift Cards for Team Rewards",
    excerpt: "Learn how businesses are using Pryva gift cards to reward team members and simplify expense management.",
    author: "Pryva Team",
    date: "2023-12-20",
    readTime: "5 min read",
    category: "Business",
  },
  {
    slug: "bulk-ordering-guide",
    title: "Complete Guide to Bulk Ordering on Pryva",
    excerpt: "Everything you need to know about bulk ordering, including discount tiers, best practices, and use cases for teams and agencies.",
    author: "Pryva Team",
    date: "2023-12-15",
    readTime: "7 min read",
    category: "Business",
  },
];

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <header className="border-b border-line bg-white">
        <div className="shell flex h-16 items-center justify-between">
          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/login"
              className="text-[0.86rem] font-medium text-ink-2 hover:text-ink"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-xl bg-lav-600 px-4 py-2 text-[0.86rem] font-semibold text-white hover:bg-lav-700"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="py-16">
        <div className="shell text-center">
          <h1 className="text-[2.5rem] font-medium tracking-tight text-ink sm:text-[3rem]">
            Pryva Blog
          </h1>
          <p className="mt-4 text-[1.1rem] text-ink-2 max-w-2xl mx-auto">
            News, updates, and guides to help you get the most out of Pryva.
          </p>
        </div>
      </section>

      {/* Blog Posts */}
      <section className="pb-16">
        <div className="shell">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="group rounded-2xl border border-line bg-white p-6 transition-all hover:shadow-[var(--shadow-card)]"
              >
                <div className="mb-4">
                  <span className="inline-block rounded-full bg-lav-100 px-3 py-1 text-[0.72rem] font-semibold text-lav-700">
                    {post.category}
                  </span>
                </div>
                <h2 className="text-[1.1rem] font-semibold text-ink mb-3 group-hover:text-lav-600">
                  {post.title}
                </h2>
                <p className="text-[0.86rem] text-ink-2 mb-4 line-clamp-3">
                  {post.excerpt}
                </p>
                <div className="flex items-center gap-4 text-[0.78rem] text-ink-3">
                  <span className="flex items-center gap-1">
                    <User className="h-3.5 w-3.5" />
                    {post.author}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {post.readTime}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
