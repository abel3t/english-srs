import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

// "Show more" section (meaning and notes, the text of a story), collapsed by default.
export function More({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Collapsible className="group/more text-sm">
      <CollapsibleTrigger asChild>
        <Button variant="link" size="sm" className="px-0 text-muted-foreground">
          {label}<ChevronDown className="transition-transform group-data-[state=open]/more:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}
