/**
 * Google Calendar Duplicate Cleanup Script
 * 
 * Run this in browser console when logged into Flowmate
 * It will find and delete duplicate events from your Google Calendar
 */

(async function cleanupGoogleCalendarDuplicates() {
    const accessToken = localStorage.getItem('flowmate_google_calendar_token');

    if (!accessToken) {
        console.error('❌ No Google Calendar token found. Please sync first to authenticate.');
        return;
    }

    console.log('🔍 Fetching events from Google Calendar...');

    try {
        // Fetch all events from the past year to 6 months ahead
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const sixMonthsFromNow = new Date();
        sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);

        const params = new URLSearchParams({
            timeMin: oneYearAgo.toISOString(),
            timeMax: sixMonthsFromNow.toISOString(),
            singleEvents: 'true', // Expand recurring for duplicate detection
            maxResults: '2500',
            orderBy: 'startTime'
        });

        const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );

        if (!response.ok) {
            if (response.status === 401) {
                console.error('❌ Token expired. Please click Sync in Calendar to refresh, then run this script again.');
            } else {
                console.error('❌ API error:', response.status, await response.text());
            }
            return;
        }

        const data = await response.json();
        const events = data.items || [];

        console.log(`📋 Found ${events.length} total events`);

        // Group events by title + start time to find duplicates
        const eventGroups = {};
        events.forEach(event => {
            const key = `${event.summary || 'Untitled'}|${event.start?.dateTime || event.start?.date}`;
            if (!eventGroups[key]) {
                eventGroups[key] = [];
            }
            eventGroups[key].push(event);
        });

        // Find duplicates (groups with more than 1 event)
        const duplicateGroups = Object.entries(eventGroups).filter(([key, group]) => group.length > 1);

        if (duplicateGroups.length === 0) {
            console.log('✅ No duplicates found! Your calendar is clean.');
            return;
        }

        console.log(`\n⚠️ Found ${duplicateGroups.length} events with duplicates:`);
        duplicateGroups.forEach(([key, group]) => {
            console.log(`   "${key.split('|')[0]}" - ${group.length} copies`);
        });

        // Prepare list of events to delete (keep the first, delete the rest)
        const eventsToDelete = [];
        duplicateGroups.forEach(([key, group]) => {
            // Keep the first one, mark rest for deletion
            group.slice(1).forEach(event => {
                eventsToDelete.push({
                    id: event.id,
                    summary: event.summary,
                    start: event.start?.dateTime || event.start?.date
                });
            });
        });

        console.log(`\n🗑️ Will delete ${eventsToDelete.length} duplicate events.`);
        console.log('⏳ Starting deletion (this may take a moment)...\n');

        let deleted = 0;
        let failed = 0;

        for (const event of eventsToDelete) {
            try {
                const deleteResponse = await fetch(
                    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${event.id}`,
                    {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    }
                );

                if (deleteResponse.ok || deleteResponse.status === 204) {
                    deleted++;
                    console.log(`   ✓ Deleted: "${event.summary}" (${event.start})`);
                } else if (deleteResponse.status === 401) {
                    console.error('❌ Token expired mid-cleanup. Run script again after clicking Sync.');
                    break;
                } else {
                    failed++;
                    console.log(`   ✗ Failed to delete: "${event.summary}" - ${deleteResponse.status}`);
                }

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (err) {
                failed++;
                console.log(`   ✗ Error deleting: "${event.summary}" - ${err.message}`);
            }
        }

        console.log(`\n✅ Cleanup complete!`);
        console.log(`   Deleted: ${deleted} duplicates`);
        if (failed > 0) console.log(`   Failed: ${failed}`);
        console.log('\n💡 Refresh your Google Calendar to see the results.');

    } catch (error) {
        console.error('❌ Error:', error);
    }
})();
