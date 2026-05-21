/*
  Developer edit point for pre_attendance.html.

  Change the text and the selectable items here. No build step is needed:
  save this file, then refresh pre_attendance.html?event=YOUR_EVENT_ID.
*/
window.PRE_ATTENDANCE_CONFIG = {
  text: {
    pageTitle: "Attendance Reply",
    pageIntro: "Please submit your attendance and transport preference before the event so the on-site team can prepare smoothly.",
    nameLabel: "Full name",
    companyLabel: "Company / Department",
    phoneLabel: "Phone",
    emailLabel: "Email",
    attendanceLegend: "Will you attend?",
    transportationLabel: "Transportation",
    goTimeLabel: "Go time",
    pickupLabel: "Pickup location",
    returnTimeLabel: "Return time",
    returnLocationLabel: "Return location",
    notesLabel: "Notes",
    submitButton: "Submit reply",
    loadingMessage: "Submitting your reply...",
    successMessage: "Thank you. Your reply has been submitted.",
    missingEventMessage: "This link is missing an event ID. Please use the event-specific link from the organizer.",
    submitErrorMessage: "Sorry, the reply could not be submitted. Please try again or contact the organizer."
  },

  attendanceOptions: [
    { value: "attending", label: "I will attend", showTrip: true },
    { value: "not_attending", label: "I will not attend", showTrip: false }
  ],

  transportationOptions: [
    { value: "coach", label: "Event coach" },
    { value: "mtr", label: "MTR / Public transport" },
    { value: "taxi", label: "Taxi / Ride hailing" },
    { value: "drive", label: "Self-drive" },
    { value: "own_arrangement", label: "Own arrangement" }
  ],

  goTimeOptions: [
    { value: "09:00", label: "09:00" },
    { value: "09:30", label: "09:30" },
    { value: "10:00", label: "10:00" },
    { value: "10:30", label: "10:30" }
  ],

  pickupLocationOptions: [
    { value: "central", label: "Central" },
    { value: "kowloon_tong", label: "Kowloon Tong" },
    { value: "tsuen_wan", label: "Tsuen Wan" },
    { value: "event_venue", label: "Meet at event venue" }
  ],

  returnTimeOptions: [
    { value: "16:00", label: "16:00" },
    { value: "16:30", label: "16:30" },
    { value: "17:00", label: "17:00" },
    { value: "17:30", label: "17:30" }
  ],

  returnLocationOptions: [
    { value: "central", label: "Central" },
    { value: "kowloon_tong", label: "Kowloon Tong" },
    { value: "tsuen_wan", label: "Tsuen Wan" },
    { value: "no_return_transport", label: "No return transport needed" }
  ]
};
