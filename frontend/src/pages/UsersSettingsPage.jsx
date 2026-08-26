import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import AdminIntelligenceSettings from "../components/AdminIntelligenceSettings.jsx";

const emptyUserForm = {