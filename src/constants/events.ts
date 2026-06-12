export interface ChurchEvent {
  id: string;
  titleKey: string;
  date: string; // ISO format or just "May 15"
  type: 'Service' | 'Wedding' | 'Camp' | 'Communion' | 'Festival' | 'Meeting';
  time?: string;
  location?: string;
  status: 'Upcoming' | 'Completed' | 'Draft';
  attendees?: number;
}

export const UPCOMING_EVENTS: ChurchEvent[] = [
  { 
    id: '1', 
    titleKey: 'sundayWorship', 
    date: '2026-05-03', 
    type: 'Service', 
    time: '10:00 AM', 
    location: 'Main Sanctuary',
    status: 'Upcoming' 
  },
  { 
    id: '2', 
    titleKey: 'youthWinterCamp', 
    date: '2026-05-10', 
    type: 'Camp', 
    time: 'All Day', 
    location: 'Blue Mountains',
    status: 'Upcoming' 
  },
  { 
    id: '3', 
    titleKey: 'holyCommunion', 
    date: '2026-05-03', 
    type: 'Communion', 
    time: '11:00 AM', 
    location: 'Main Sanctuary',
    status: 'Upcoming' 
  },
  { 
    id: '4', 
    titleKey: 'johnMaryWedding', 
    date: '2026-05-16', 
    type: 'Wedding', 
    time: '02:00 PM', 
    location: 'Gardens',
    status: 'Upcoming' 
  },
  { 
    id: '5', 
    titleKey: 'goodFriday', 
    date: '2026-04-03', 
    type: 'Festival', 
    time: '09:00 AM', 
    location: 'Main Sanctuary',
    status: 'Completed' 
  },
  { 
    id: '6', 
    titleKey: 'anniversaryCelebration', 
    date: '2026-05-24', 
    type: 'Festival', 
    time: '10:00 AM', 
    location: 'Church Hall',
    status: 'Upcoming' 
  }
];
