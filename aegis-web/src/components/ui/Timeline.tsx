import { cn } from "@/lib/utils";

interface TimelineEvent {
  year: string;
  title: string;
  description: string;
}

interface TimelineProps {
  events: TimelineEvent[];
  className?: string;
}

export function Timeline({ events, className }: TimelineProps) {
  return (
    <div className={cn("relative border-l-2 border-[var(--snc-gold)]/30 ml-4 md:ml-6", className)}>
      {events.map((event, index) => (
        <div key={index} className="mb-12 relative pl-8 md:pl-12">
          {/* Connector Node */}
          <div className="absolute -left-[9px] top-1.5 h-4 w-4 rounded-full border-2 border-[var(--snc-gold)] bg-[var(--snc-navy)]" />
          
          <div className="text-[var(--snc-gold)] font-display text-2xl tracking-wider mb-2">
            {event.year}
          </div>
          <h3 className="text-xl font-bold text-[var(--snc-white)] mb-3">
            {event.title}
          </h3>
          <p className="text-[var(--snc-mist)] max-w-2xl">
            {event.description}
          </p>
        </div>
      ))}
    </div>
  );
}
