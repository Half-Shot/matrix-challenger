export interface IActivity {
    id: string;
    distance: number; // in meters
    duration: number;
    elevation: number;
    createdAt: string;
    activityType: string;
    activityName: string;
    user: {
        id: string;
        fullname: string;
        fname: string;
        lname: string;
    }
}

export interface ILeader {
    id: string;
    fullname: string;
    duration: number;
    distance: number;
    elevation: number;
}